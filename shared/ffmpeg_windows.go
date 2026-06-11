//go:build windows

package shared

import (
	"os/exec"
	"syscall"

	ffmpeg "github.com/u2takey/ffmpeg-go"
)

// createNoWindow (CREATE_NO_WINDOW) prevents Windows from allocating a console
// window for the child process. Without it, a production GUI build (which has no
// console of its own) spawns a visible console window for every ffmpeg call.
const createNoWindow = 0x08000000

func init() {
	ffmpeg.GlobalCommandOptions = append(ffmpeg.GlobalCommandOptions,
		func(cmd *exec.Cmd) {
			if cmd.SysProcAttr == nil {
				cmd.SysProcAttr = &syscall.SysProcAttr{}
			}
			cmd.SysProcAttr.HideWindow = true
			cmd.SysProcAttr.CreationFlags |= createNoWindow
		})
}
