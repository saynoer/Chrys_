// Signs the macOS app before electron-builder makes the dmg (its own signing is off,
// `mac.identity: null`: it only takes a certificate macOS trusts, and ours is self-signed).
//
// The signature has to be a real one, tied to the bundle. Without it, TCC identifies the app
// by its executable path whenever a helper asks on its behalf, so the audio service is refused
// the screen capture behind system audio, while screenshots, taken in the main process, work
// (#104). Ad-hoc signing fixes that too, but its requirement is a hash of this very build, so
// every update would lose the permission. The self-signed certificate's requirement,
// `identifier "com.electron.app" and certificate leaf = H"<SHA_1>"`, stays the same across
// releases as long as the certificate does.
//
// CI imports the certificate into a keychain and passes it as MAC_SIGN_KEYCHAIN. Elsewhere
// the certificate is looked up in the default keychains, else the app is signed ad-hoc.
import { execFileSync } from 'node:child_process'
import path from 'node:path'

// SHA-1 of the "Interview Coder CN" certificate; a new one changes every user's TCC entry
const CERT_SHA1 = 'CD7CAF3BDF9CE72B08E6141A7D186D1CCC9DDA3A'

function hasCertificate(keychain) {
  const args = ['find-identity', '-p', 'codesigning']
  if (keychain) args.push(keychain)
  // Without -v: an untrusted self-signed certificate is not "valid", but codesign can use it
  return execFileSync('security', args, { encoding: 'utf8' }).includes(CERT_SHA1)
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const keychain = process.env.MAC_SIGN_KEYCHAIN
  let identity = CERT_SHA1
  if (!hasCertificate(keychain)) {
    if (process.env.CI) {
      throw new Error(
        `Signing certificate ${CERT_SHA1} not found, the macOS release must not ship without it`
      )
    }
    console.warn(
      '  • signing certificate not found, signing ad-hoc (permissions will not survive the next build)'
    )
    identity = '-'
  }

  const args = ['--force', '--deep', '--timestamp=none', '--sign', identity]
  if (keychain && identity !== '-') args.push('--keychain', keychain)
  execFileSync('codesign', [...args, appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
}
