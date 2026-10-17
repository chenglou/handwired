// Downloads a WAD for the Doom port, src/doom, into .cache/doom/ and checks it against known SHA-256 digests.
//
//   bun scripts/fetch-doom-wad.ts            Doom's shareware DOOM1.WAD 1.9, from Debian's doom-wad-shareware source
//                                            package. id Software's shareware terms let it be copied and passed on unmodified
//                                            and free of charge, and Debian keeps it in non-free since it may not be
//                                            modified.
//   bun scripts/fetch-doom-wad.ts freedoom   Freedoom 0.13.0's freedoom1.wad, under a BSD-style license.
//
// Neither is part of the repo: .cache/ is ignored, and the demo site doesn't serve the Doom page.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {gunzipSync, inflateRawSync} from 'node:zlib'

const cache = resolve(import.meta.dir, '../.cache/doom')

type Source = {file: string, url: string, archiveSha256: string, member: string, wadSha256: string, format: 'tar.gz' | 'zip'}

const sources: Record<string, Source> = {
  shareware: {
    file: 'doom1.wad',
    url: 'https://deb.debian.org/debian/pool/non-free/d/doom-wad-shareware/doom-wad-shareware_1.9.fixed.orig.tar.gz',
    archiveSha256: 'e02c8b5e01be7373d4c53f82556118e2aaaf8f83fa2af5eee1efadf9c55c4eb1',
    member: 'doom-wad-shareware-1.9.fixed/doom1.wad',
    // MD5 f0cefca49926d00903cf57551d901abe, the 1.9 shareware WAD's well-known digest.
    wadSha256: '1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771',
    format: 'tar.gz',
  },
  freedoom: {
    file: 'freedoom1.wad',
    url: 'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',
    // As Freedoom's signed CHECKSUM file lists it.
    archiveSha256: '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59',
    member: 'freedoom-0.13.0/freedoom1.wad',
    wadSha256: '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d',
    format: 'zip',
  },
}

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

function fromTarGz(archive: Uint8Array, member: string) {
  const tar = new Uint8Array(gunzipSync(archive))
  let at = 0
  while (at + 512 <= tar.length) {
    const name = new TextDecoder().decode(tar.subarray(at, at + 100)).replace(/\0.*$/s, '')
    if (name === '') break
    const size = parseInt(new TextDecoder().decode(tar.subarray(at + 124, at + 136)).replace(/\0.*$/s, '').trim(), 8)
    if (name === member) return tar.slice(at + 512, at + 512 + size)
    at += 512 + Math.ceil(size / 512) * 512
  }
  return null
}

function fromZip(zip: Uint8Array, member: string) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let end = zip.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('not a zip file')
  let at = view.getUint32(end + 16, true)
  for (let entry = 0; entry < view.getUint16(end + 10, true); entry++) {
    const nameLength = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength))
    if (name === member) {
      const local = view.getUint32(at + 42, true)
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const data = zip.subarray(start, start + view.getUint32(at + 20, true))
      return view.getUint16(at + 10, true) === 0 ? data.slice() : new Uint8Array(inflateRawSync(data))
    }
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return null
}

const source = sources[process.argv[2] ?? 'shareware']
if (source === undefined) throw new Error(`unknown WAD ${process.argv[2]}: use shareware or freedoom`)
const target = resolve(cache, source.file)
// A WAD already there is kept if it is the right one, and fetched again if not, e.g. after an interrupted write.
if (existsSync(target)) {
  if (sha256(new Uint8Array(readFileSync(target))) === source.wadSha256) {
    console.log(`${target} is already there`)
    process.exit(0)
  }
  console.log(`${target} doesn't have the expected SHA-256, so it is fetched again`)
}
console.log(`downloading ${source.url}`)
const response = await fetch(source.url).catch((error: unknown) => {
  throw new Error(`couldn't reach ${new URL(source.url).host}: ${error instanceof Error ? error.message : String(error)}`)
})
if (!response.ok) throw new Error(`download failed: ${response.status}`)
const archive = new Uint8Array(await response.arrayBuffer())
if (sha256(archive) !== source.archiveSha256) throw new Error(`the archive's SHA-256 is ${sha256(archive)}, expected ${source.archiveSha256}`)
const wad = source.format === 'zip' ? fromZip(archive, source.member) : fromTarGz(archive, source.member)
if (wad === null) throw new Error(`${source.member} is not in the archive`)
if (sha256(wad) !== source.wadSha256) throw new Error(`the WAD's SHA-256 is ${sha256(wad)}, expected ${source.wadSha256}`)
mkdirSync(cache, {recursive: true})
// Written beside it and renamed, so the WAD is either whole or not there.
writeFileSync(`${target}.partial`, wad)
renameSync(`${target}.partial`, target)
console.log(`wrote ${target}, ${wad.length} bytes`)
