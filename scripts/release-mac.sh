#!/usr/bin/env bash
# Build Dobby for Mac (universal: Apple Silicon + Intel), signed with Developer ID and notarized.
#
# One-time setup:
#   - "Developer ID Application" certificate in Keychain → security find-identity -v -p codesigning
#   - notarytool profile in Keychain                    → xcrun notarytool store-credentials <profile> ...
#
#   bash scripts/release-mac.sh
#   DOBBY_SIGN_IDENTITY="Developer ID Application: ..." DOBBY_NOTARY_PROFILE=hey-notary bash scripts/release-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY=${DOBBY_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}
PROFILE=${DOBBY_NOTARY_PROFILE:-hey-notary}
[ -n "$IDENTITY" ] || { echo "No Developer ID Application certificate in Keychain" >&2; exit 1; }
VER=$(node -p "require('./package.json').version")
echo "▶ Dobby $VER · signing: $IDENTITY · notarize profile: $PROFILE"

npm run build
npm test

# electron-builder signs every binary with the hardened runtime; notarization happens below.
export CSC_NAME="${IDENTITY#Developer ID Application: }"
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER
for attempt in 1 2 3; do
  npx electron-builder --mac dmg --universal && break
  [ "$attempt" = 3 ] && { echo "Packaging failed 3 times" >&2; exit 1; }
  echo "⚠ Packaging failed (attempt $attempt) — detaching leftover DMGs and retrying…"
  for v in /Volumes/Dobby*; do [ -e "$v" ] && hdiutil detach "$v" -force; done
  sleep 10
done

APP="release/mac-universal/Dobby.app"
DMG="release/Dobby-$VER-mac-universal.dmg"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "▶ Submitting for notarization (a few minutes)…"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
shasum -a 256 "$DMG"
echo "✓ Ready: $DMG"
