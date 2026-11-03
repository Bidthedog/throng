#!/bin/sh
# The .rpm's post step does nothing. rpm runs it before the old package's obsolete files are gone, so the setup waits for
# posttrans (063 research D2). electron-builder always passes one, so this is what it gets.
exit 0
