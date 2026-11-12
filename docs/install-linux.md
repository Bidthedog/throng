[throng](../README.md) › [Docs](README.md) › Installing on Linux

# Installing throng on Linux

Ubuntu 22.04 or later and Fedora's supported releases are tested, on x64. Their relatives are expected to work. No
Node.js, compiler or other runtime is needed.

## Quick start

On Ubuntu, Debian and their relatives:

```bash
wget -qO- https://throng-ide.com/throng-repo-key.asc | sudo tee /usr/share/keyrings/throng.asc > /dev/null
echo 'deb [signed-by=/usr/share/keyrings/throng.asc] mirror+https://throng-ide.com/apt/prerelease.list prerelease main' | sudo tee /etc/apt/sources.list.d/throng.list
sudo apt update
sudo apt install throng
```

On Fedora and its relatives, accepting the key when `dnf` shows it:

```bash
sudo curl -fsSL -o /etc/yum.repos.d/throng.repo https://throng-ide.com/rpm/throng-prerelease.repo
sudo dnf install throng
```

throng then appears in your applications, and `throng` works in a shell. Later releases arrive with your ordinary
system updates. Next, take the [tour](quick-start.md). What differs on Linux is listed in [Linux](linux.md).

## The package repository

The [quick start](#quick-start) adds it. There are two channels: `stable` holds full releases and starts with 1.0.0,
and `prerelease` holds every release, alphas included. The commands use `prerelease`, so replace the word with `stable`
from 1.0.0 onwards if you want only full releases.

The repository's index is signed, and your package manager refuses one that is changed or unsigned. The key is trusted
for throng's repository alone. The packages themselves download from throng's GitHub releases, and each is checked
against the signed index. To change channel, run the same commands again with the other word, then
`sudo apt update` or `sudo dnf check-update`.

To stop using the repository, delete `/etc/apt/sources.list.d/throng.list` and `/usr/share/keyrings/throng.asc`, or
`/etc/yum.repos.d/throng.repo`. throng stays installed until you [remove it](#removing-throng).

## Downloading a package

To install a single download instead, pick the one that suits your machine from the
[Releases page](https://github.com/Bidthedog/throng/releases). That release's notes list a SHA-256 checksum for every
download: compare it with what `sha256sum <file>` prints, and if they differ, delete the file and download it again.

| Download | Choose it when | Install it with |
|---|---|---|
| `throng-<version>-amd64.deb` | Ubuntu, Debian and their relatives | `sudo apt install ./throng-<version>-amd64.deb` |
| `throng-<version>-x86_64.rpm` | Fedora and its relatives | `sudo dnf install ./throng-<version>-x86_64.rpm` |
| `throng-<version>-linux-x64.tar.gz` | Any other distribution, or no administrator rights | `tar -xzf throng-<version>-linux-x64.tar.gz`, then run `throng` from that folder |

The `.deb` and `.rpm` install one copy for every account on the machine, each with its own data. throng then appears
in your applications, and `throng` works in a shell.

## The sandbox

throng keeps its browser sandbox on. On a machine that restricts what the sandbox needs, as recent Ubuntu does, the
`.deb` and `.rpm` allow it for throng alone and change no system setting. An archive tells you what is wrong, and gives
the two commands that allow it for that folder. They need administrator rights, and the folder's path must have no
spaces in it.

## Upgrading

From [the package repository](#the-package-repository), `sudo apt upgrade` or `sudo dnf upgrade` takes the newer version
along with your other updates. For a downloaded package, install the newer one with the same command. Your projects and
settings are kept. throng itself never checks for updates or downloads them.

A throng left open keeps running the version it started with, with its terminals, until you restart it. It tells you a
newer version is installed, and offers the restart. Restarting may end the terminals running in it.

The version it was running stays in `/opt/throng-versions` until the next time throng is installed. Nothing runs from it
once throng has restarted, so it is safe to delete by hand.

## Opening a folder as a project

A package adds **Open as throng project** to the folder menu of Nemo and Dolphin. GNOME Files has no such menu for
applications, so there it is listed under **Open With**. From a terminal, `throng <path>` does the same, with a relative
path read from where you ran it. The archive adds nothing to a file manager.
To remove the item for your account only, turn it off in [Preferences](preferences.md#projects); that needs no
administrator rights.

## Downgrading

Installing an older `.deb` or `.rpm` over a newer one is refused, and changes nothing. To go back, remove throng first,
then install the older package. Your projects and settings are kept, though an older version may not read everything a
newer one wrote.

## Removing throng

`sudo apt remove throng` or `sudo dnf remove throng`. For an archive, delete its folder.

Your projects and settings are always kept, and installing again finds them. To delete them too, delete these folders
in your home folder: `.config/throng` and `.local/share/throng`. A throng left open during the removal keeps running
until you close it, and a terminal still running in it is not ended.
