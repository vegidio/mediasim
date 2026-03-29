package dsu

type DSU struct {
	parent []int
	rank   []int
}

// NewDSU initializes a DSU for n elements.
func NewDSU(n int) *DSU {
	p := make([]int, n)
	for i := range p {
		p[i] = i
	}

	return &DSU{parent: p, rank: make([]int, n)}
}

// Find with path compression.
func (d *DSU) Find(x int) int {
	if d.parent[x] != x {
		d.parent[x] = d.Find(d.parent[x])
	}

	return d.parent[x]
}

// Union by rank.
func (d *DSU) Union(x, y int) {
	xRoot := d.Find(x)
	yRoot := d.Find(y)

	if xRoot == yRoot {
		return
	}

	if d.rank[xRoot] < d.rank[yRoot] {
		d.parent[xRoot] = yRoot
	} else if d.rank[xRoot] > d.rank[yRoot] {
		d.parent[yRoot] = xRoot
	} else {
		d.parent[yRoot] = xRoot
		d.rank[xRoot]++
	}
}
