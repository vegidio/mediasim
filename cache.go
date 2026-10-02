package mediasim

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/gob"
	"io"
	"os"
	"path/filepath"
	"sync"

	. "github.com/vegidio/go-sak/types"
	"github.com/vitali-fedulov/images4"
)

const (
	// CacheFileName is the name of the cache file created in a directory when DirectoryOptions.UseCache is enabled.
	CacheFileName = ".mediasim.cache"

	cacheMagic = "MEDIASIM-CACHE"
	// cacheVersion must be bumped whenever the fingerprint or frame extraction logic changes, to invalidate old caches.
	cacheVersion = 1
	// maxRecordSize guards against huge allocations when the length prefix of a record is corrupt.
	maxRecordSize = 64 * 1024 * 1024
)

// cacheRecord is the on-disk representation of a loaded media file.
type cacheRecord struct {
	Rel         string
	Size        int64
	ModTime     int64
	FrameFlip   bool
	FrameRotate bool

	Type   string
	Width  int
	Height int
	Length int

	FramesOriginal   []images4.IconT
	FramesFlippedV   []images4.IconT
	FramesFlippedH   []images4.IconT
	FramesRotated90  []images4.IconT
	FramesRotated180 []images4.IconT
	FramesRotated270 []images4.IconT
}

// mediaCache is a persistent, append-only cache of media fingerprints stored in a directory.
//
// Each record is written as soon as a file is loaded, so an interrupted run keeps everything processed so far. An entry
// is only reused when the file's size and modification time are unchanged.
type mediaCache struct {
	mu      sync.Mutex
	path    string
	file    *os.File
	entries map[string]cacheRecord
	// records is the number of records currently stored in the file, including duplicates and stale entries.
	records int
	// used holds the entries that were hit or written during the current run.
	used map[string]bool
}

// openCache opens (or creates) the cache file in the given directory and loads all valid records from it.
func openCache(directory string) (*mediaCache, error) {
	path := filepath.Join(directory, CacheFileName)

	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return nil, err
	}

	c := &mediaCache{
		path:    path,
		file:    file,
		entries: make(map[string]cacheRecord),
		used:    make(map[string]bool),
	}

	offset := c.load()

	// Drop anything after the last valid record (e.g. a record truncated by a crash) and append from there.
	if err = file.Truncate(offset); err == nil {
		_, err = file.Seek(offset, io.SeekStart)
	}
	if err == nil && offset == 0 {
		_, err = file.Write(cacheHeader())
	}
	if err != nil {
		file.Close()
		return nil, err
	}

	return c, nil
}

// load reads the header and all valid records from the cache file. It returns the offset right after the last valid
// record, or 0 if the header is missing or incompatible.
func (c *mediaCache) load() int64 {
	header := cacheHeader()
	r := bufio.NewReader(c.file)

	buf := make([]byte, len(header))
	if _, err := io.ReadFull(r, buf); err != nil || !bytes.Equal(buf, header) {
		return 0
	}

	offset := int64(len(header))

	for {
		size, err := binary.ReadUvarint(r)
		if err != nil || size > maxRecordSize {
			return offset
		}

		data := make([]byte, size)
		if _, err = io.ReadFull(r, data); err != nil {
			return offset
		}

		var rec cacheRecord
		if err = gob.NewDecoder(bytes.NewReader(data)).Decode(&rec); err != nil {
			return offset
		}

		c.entries[rec.Rel] = rec
		c.records++
		offset += int64(uvarintLen(size)) + int64(size)
	}
}

// get returns the cached media for the given file, if the entry is still valid for the file's size, modification time
// and the requested frame options.
func (c *mediaCache) get(rel string, size, modTime int64, options FrameOptions) (Media, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	rec, ok := c.entries[rel]
	if !ok || rec.Size != size || rec.ModTime != modTime ||
		(options.FrameFlip && !rec.FrameFlip) || (options.FrameRotate && !rec.FrameRotate) {
		return Media{}, false
	}

	c.used[rel] = true

	media := Media{
		Type:   rec.Type,
		Width:  rec.Width,
		Height: rec.Height,
		Size:   rec.Size,
		Length: rec.Length,
	}

	// Only expose the frame variants requested in this run, so the similarity results are the same as without cache.
	media.framesOriginal = rec.FramesOriginal
	if options.FrameFlip {
		media.framesFlippedV, media.framesFlippedH = rec.FramesFlippedV, rec.FramesFlippedH
	}
	if options.FrameRotate {
		media.framesRotated90, media.framesRotated180, media.framesRotated270 =
			rec.FramesRotated90, rec.FramesRotated180, rec.FramesRotated270
	}

	return media, true
}

// put stores the media in the cache and appends it to the cache file.
func (c *mediaCache) put(rel string, size, modTime int64, options FrameOptions, media Media) error {
	rec := cacheRecord{
		Rel:              rel,
		Size:             size,
		ModTime:          modTime,
		FrameFlip:        options.FrameFlip,
		FrameRotate:      options.FrameRotate,
		Type:             media.Type,
		Width:            media.Width,
		Height:           media.Height,
		Length:           media.Length,
		FramesOriginal:   media.framesOriginal,
		FramesFlippedV:   media.framesFlippedV,
		FramesFlippedH:   media.framesFlippedH,
		FramesRotated90:  media.framesRotated90,
		FramesRotated180: media.framesRotated180,
		FramesRotated270: media.framesRotated270,
	}

	data, err := encodeRecord(rec)
	if err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[rel] = rec
	c.used[rel] = true

	if _, err = c.file.Write(data); err != nil {
		return err
	}

	c.records++
	return nil
}

// compact rewrites the cache file keeping only the entries used in the current run, dropping duplicates and entries of
// files that were deleted or changed. It's a no-op if the file has no stale records.
func (c *mediaCache) compact() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.records == len(c.used) {
		return nil
	}

	tmp, err := os.CreateTemp(filepath.Dir(c.path), CacheFileName+".*.tmp")
	if err != nil {
		return err
	}

	defer os.Remove(tmp.Name())

	w := bufio.NewWriter(tmp)
	_, err = w.Write(cacheHeader())

	for rel := range c.used {
		if err != nil {
			break
		}

		var data []byte
		if data, err = encodeRecord(c.entries[rel]); err == nil {
			_, err = w.Write(data)
		}
	}

	if err == nil {
		err = w.Flush()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}

	if err = os.Rename(tmp.Name(), c.path); err != nil {
		return err
	}

	// The open handle still points to the old file; reopen it so further writes go to the compacted one.
	file, err := os.OpenFile(c.path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}

	c.file.Close()
	c.file = file
	c.records = len(c.used)

	return nil
}

func (c *mediaCache) close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.file.Close()
}

func cacheHeader() []byte {
	return binary.AppendUvarint([]byte(cacheMagic), cacheVersion)
}

// encodeRecord serializes a record as a uvarint length prefix followed by its gob encoding. Each record uses its own
// encoder so it can be decoded independently of the others.
func encodeRecord(rec cacheRecord) ([]byte, error) {
	var body bytes.Buffer
	if err := gob.NewEncoder(&body).Encode(rec); err != nil {
		return nil, err
	}

	data := binary.AppendUvarint(make([]byte, 0, body.Len()+binary.MaxVarintLen64), uint64(body.Len()))
	return append(data, body.Bytes()...), nil
}

func uvarintLen(x uint64) int {
	return len(binary.AppendUvarint(nil, x))
}

// loadMediaWithCache loads a media file, reusing the cached fingerprints when the file hasn't changed.
func loadMediaWithCache(cache *mediaCache, directory, filePath string, options FrameOptions) Result[Media] {
	info, err := os.Stat(filePath)
	if err != nil {
		return loadMediaResult(filePath, options)
	}

	rel, err := filepath.Rel(directory, filePath)
	if err != nil {
		rel = filePath
	}

	size, modTime := info.Size(), info.ModTime().UnixNano()

	if media, ok := cache.get(rel, size, modTime, options); ok {
		media.Name = filePath
		return Result[Media]{Data: media}
	}

	result := loadMediaResult(filePath, options)
	if result.Err == nil {
		// A failed write only means this file will be processed again next time.
		_ = cache.put(rel, size, modTime, options, result.Data)
	}

	return result
}

func loadMediaResult(filePath string, options FrameOptions) Result[Media] {
	media, err := LoadMediaFromFile(filePath, options)
	if err != nil {
		return Result[Media]{Err: err}
	}

	return Result[Media]{Data: *media}
}
