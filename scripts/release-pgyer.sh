#!/bin/bash

set -euo pipefail
set +x

readonly KEYCHAIN_SERVICE="com.bwchat.pgyer.api-key"
readonly KEYCHAIN_ACCOUNT="BWChat"
readonly PROJECT="BWChat.xcodeproj"
readonly SCHEME="BWChat"
readonly EXPORT_OPTIONS="config/pgyer/ExportOptions.plist"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

install_mode=""
notes=""
prebuilt_ipa=""
bump_build=1
allow_dirty=0
assume_yes=0

usage() {
    cat <<'EOF'
Usage:
  scripts/release-pgyer.sh (--private | --public) [options]

Options:
  --private          Password-protected install. Prompts without echo.
  --public           Public install. Must be selected explicitly.
  --notes TEXT       Release notes. Defaults to the latest Git subject.
  --ipa PATH         Upload an existing signed IPA and skip archive/export.
  --no-bump          Keep the current Xcode build number.
  --allow-dirty      Allow tracked uncommitted changes in the package.
  --yes              Skip the final interactive upload confirmation.
  -h, --help         Show this help.

The Pgyer API key is read from macOS Keychain service:
  com.bwchat.pgyer.api-key (account BWChat)

This script archives and uploads. Run the Xcode test suite before release.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --private)
            install_mode="private"
            ;;
        --public)
            install_mode="public"
            ;;
        --notes)
            shift
            [ "$#" -gt 0 ] || { echo "Missing value for --notes" >&2; exit 2; }
            notes="$1"
            ;;
        --ipa)
            shift
            [ "$#" -gt 0 ] || { echo "Missing value for --ipa" >&2; exit 2; }
            prebuilt_ipa="$1"
            ;;
        --no-bump)
            bump_build=0
            ;;
        --allow-dirty)
            allow_dirty=1
            ;;
        --yes)
            assume_yes=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
    shift
done

if [ -z "$install_mode" ]; then
    echo "Choose exactly one install mode: --private or --public" >&2
    exit 2
fi

for command_name in asc curl jq plutil security; do
    command -v "$command_name" >/dev/null 2>&1 || {
        echo "Missing required command: $command_name" >&2
        exit 1
    }
done

plutil -lint "$EXPORT_OPTIONS" >/dev/null

if [ -n "$prebuilt_ipa" ]; then
    [ -f "$prebuilt_ipa" ] || { echo "IPA not found: $prebuilt_ipa" >&2; exit 1; }
    case "$prebuilt_ipa" in
        *.ipa) ;;
        *) echo "Prebuilt artifact must be an .ipa file." >&2; exit 1 ;;
    esac
    bump_build=0
fi

if [ "$allow_dirty" -ne 1 ]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "Tracked changes are present. Commit them or pass --allow-dirty after review." >&2
        exit 1
    fi
fi

if [ -z "$notes" ]; then
    notes="$(git log -1 --pretty=%s 2>/dev/null || true)"
fi

api_key="$(security find-generic-password \
    -a "$KEYCHAIN_ACCOUNT" \
    -s "$KEYCHAIN_SERVICE" \
    -w 2>/dev/null || true)"

if [ -z "$api_key" ]; then
    echo "Pgyer API key is not available in macOS Keychain." >&2
    exit 1
fi

install_type="1"
install_password=""
if [ "$install_mode" = "private" ]; then
    install_type="2"
    if [ -n "${PGYER_INSTALL_PASSWORD:-}" ]; then
        install_password="$PGYER_INSTALL_PASSWORD"
    elif [ -t 0 ]; then
        printf "Pgyer install password: "
        IFS= read -r -s install_password
        printf "\n"
    else
        echo "Private release requires PGYER_INSTALL_PASSWORD in non-interactive mode." >&2
        exit 1
    fi
    if [ -z "$install_password" ]; then
        echo "Install password cannot be empty." >&2
        exit 1
    fi
fi

cleanup() {
    unset api_key install_password PGYER_INSTALL_PASSWORD
}
trap cleanup EXIT

if [ "$bump_build" -eq 1 ]; then
    echo "Incrementing Xcode build number..."
    asc xcode version bump \
        --type build \
        --project "$PROJECT" \
        --target "$SCHEME" \
        --output json >/dev/null
fi

version_json="$(asc xcode version view \
    --project "$PROJECT" \
    --target "$SCHEME" \
    --output json)"
version="$(jq -r '.version' <<< "$version_json")"
build_number="$(jq -r '.buildNumber' <<< "$version_json")"

artifact_dir=".asc/artifacts"
archive_path="$artifact_dir/BWChat-${version}-${build_number}.xcarchive"
if [ -n "$prebuilt_ipa" ]; then
    ipa_path="$prebuilt_ipa"
    echo "Reusing signed IPA: $ipa_path"
else
    ipa_path="$artifact_dir/BWChat-${version}-${build_number}.ipa"
    mkdir -p "$artifact_dir"

    echo "Archiving BWChat ${version} (${build_number})..."
    asc xcode archive \
        --project "$PROJECT" \
        --scheme "$SCHEME" \
        --configuration Release \
        --clean \
        --archive-path "$archive_path" \
        --overwrite \
        --xcodebuild-flag=-destination \
        --xcodebuild-flag=generic/platform=iOS \
        --xcodebuild-flag=-allowProvisioningUpdates \
        --output json >/dev/null

    echo "Exporting signed IPA..."
    asc xcode export \
        --archive-path "$archive_path" \
        --export-options "$EXPORT_OPTIONS" \
        --ipa-path "$ipa_path" \
        --overwrite \
        --xcodebuild-flag=-allowProvisioningUpdates \
        --output json >/dev/null
fi

if [ "$assume_yes" -ne 1 ]; then
    printf "Upload BWChat %s (%s) to Pgyer now? [y/N] " "$version" "$build_number"
    IFS= read -r answer
    case "$answer" in
        y|Y|yes|YES) ;;
        *) echo "Upload cancelled. IPA kept at $ipa_path"; exit 0 ;;
    esac
fi

echo "Requesting secure Pgyer upload slot..."
token_args=(
    --data-urlencode "_api_key=$api_key"
    --data "buildType=ios"
    --data "buildInstallType=$install_type"
    --data-urlencode "buildUpdateDescription=$notes"
)
if [ "$install_type" = "2" ]; then
    token_args+=(--data-urlencode "buildPassword=$install_password")
fi

token_response="$(curl --fail-with-body -sS -X POST \
    "https://www.pgyer.com/apiv2/app/getCOSToken" \
    "${token_args[@]}")"
token_code="$(jq -r '.code // -1' <<< "$token_response")"
if [ "$token_code" != "0" ]; then
    token_message="$(jq -r '.message // "unknown error"' <<< "$token_response")"
    echo "Pgyer rejected the upload request: $token_message (code $token_code)" >&2
    exit 1
fi

endpoint="$(jq -r '.data.endpoint // empty' <<< "$token_response")"
build_key="$(jq -r '.data.key // empty' <<< "$token_response")"
upload_key="$(jq -r '.data.params.key // empty' <<< "$token_response")"
signature="$(jq -r '.data.params.signature // empty' <<< "$token_response")"
security_token="$(jq -r '.data.params["x-cos-security-token"] // empty' <<< "$token_response")"

case "$endpoint" in
    https://*) ;;
    *) echo "Pgyer returned an invalid upload endpoint." >&2; exit 1 ;;
esac
if [ -z "$build_key" ] || [ -z "$upload_key" ] || [ -z "$signature" ] || [ -z "$security_token" ]; then
    echo "Pgyer upload credentials are incomplete." >&2
    exit 1
fi

echo "Uploading IPA..."
upload_status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$endpoint" \
    -F "key=$upload_key" \
    -F "signature=$signature" \
    -F "x-cos-security-token=$security_token" \
    -F "x-cos-meta-file-name=$(basename "$ipa_path")" \
    -F "file=@$ipa_path")"
if [ "$upload_status" != "204" ]; then
    echo "Pgyer file upload failed with HTTP $upload_status." >&2
    exit 1
fi

unset token_response signature security_token endpoint

echo "Waiting for Pgyer to publish the build..."
deadline=$((SECONDS + 300))
while [ "$SECONDS" -lt "$deadline" ]; do
    info_response="$(curl --fail-with-body -sS -G \
        "https://www.pgyer.com/apiv2/app/buildInfo" \
        --data-urlencode "_api_key=$api_key" \
        --data-urlencode "buildKey=$build_key")"
    info_code="$(jq -r '.code // -1' <<< "$info_response")"

    if [ "$info_code" = "0" ]; then
        app_name="$(jq -r '.data.buildName // "BWChat"' <<< "$info_response")"
        published_version="$(jq -r '.data.buildVersion // empty' <<< "$info_response")"
        published_build="$(jq -r '.data.buildVersionNo // empty' <<< "$info_response")"
        shortcut="$(jq -r '.data.buildShortcutUrl // empty' <<< "$info_response")"
        qr_url="$(jq -r '.data.buildQRCodeURL // empty' <<< "$info_response")"
        echo "Published: $app_name $published_version ($published_build)"
        if [ -n "$shortcut" ]; then
            echo "Install: https://www.pgyer.com/$shortcut"
        fi
        if [ -n "$qr_url" ]; then
            echo "QR code: $qr_url"
        fi
        echo "IPA: $ipa_path"
        exit 0
    fi

    if [ "$info_code" != "1247" ]; then
        info_message="$(jq -r '.message // "unknown error"' <<< "$info_response")"
        echo "Pgyer publishing failed: $info_message (code $info_code)" >&2
        exit 1
    fi

    sleep 5
done

echo "Timed out waiting for Pgyer after 5 minutes." >&2
exit 1
