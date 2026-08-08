#!/bin/zsh

set -eu

readonly SCRIPT_DIR="${0:A:h}"
readonly PROJECT_DIR="${SCRIPT_DIR:h}"
readonly DEVELOPER_DIR_PATH="/Applications/Xcode.app/Contents/Developer"
readonly NATIVE_UDID="4CDB4BB3-F3A0-452E-8043-EC68EF7C1E4C"
readonly EXPO_UDID="98115C4F-1923-423B-8B76-CF07ED611A49"
readonly EXPECTED_RUNTIME="com.apple.CoreSimulator.SimRuntime.iOS-26-4"
readonly EXPECTED_DEVICE_TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max"
readonly BUNDLED_PYTHON="/Users/wegpt.com/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"

CAPTURE_TMP=""

usage() {
  /bin/echo "Usage:"
  /bin/echo "  $0 status"
  /bin/echo "  $0 boot [light|dark]"
  /bin/echo "  $0 normalize [light|dark]"
  /bin/echo "  $0 shutdown"
  /bin/echo "  $0 open-url native|expo <url>"
  /bin/echo "  $0 capture <slug> <state> component [x y width height]"
  /bin/echo "  $0 capture <slug> <state> pixel [tolerance]"
  /bin/echo
  /bin/echo "The pair is fixed to iPhone 17 Pro Max / iOS 26.4. Capture publishes exactly"
  /bin/echo "native.png, expo.png, diff-8x.png and metrics.json for each accepted state."
}

cleanup_tmp() {
  if [[ -n "${CAPTURE_TMP}" && -d "${CAPTURE_TMP}" ]]; then
    /usr/bin/find "${CAPTURE_TMP}" -depth -delete
  fi
}

trap cleanup_tmp EXIT INT TERM

run_simctl() {
  DEVELOPER_DIR="${DEVELOPER_DIR_PATH}" /usr/bin/xcrun simctl "$@"
}

python_bin() {
  if [[ -n "${BWCHAT_VISUAL_PYTHON:-}" && -x "${BWCHAT_VISUAL_PYTHON}" ]]; then
    /bin/echo "${BWCHAT_VISUAL_PYTHON}"
  elif [[ -x "${BUNDLED_PYTHON}" ]]; then
    /bin/echo "${BUNDLED_PYTHON}"
  else
    /usr/bin/command -v python3
  fi
}

device_record() {
  local udid="$1"
  run_simctl list devices -j | /usr/bin/jq -c --arg udid "${udid}" '
    .devices | to_entries[] | .key as $runtime | .value[] |
    select(.udid == $udid) |
    {runtime: $runtime, name, udid, state, deviceTypeIdentifier}
  '
}

validate_device() {
  local label="$1"
  local udid="$2"
  local record count runtime device_type
  record="$(device_record "${udid}")"
  count="$(/bin/echo "${record}" | /usr/bin/awk 'NF { count += 1 } END { print count + 0 }')"
  if [[ "${count}" != "1" ]]; then
    /bin/echo "Refusing: ${label} fixed simulator ${udid} resolved to ${count} records." >&2
    exit 2
  fi
  runtime="$(/bin/echo "${record}" | /usr/bin/jq -r '.runtime')"
  device_type="$(/bin/echo "${record}" | /usr/bin/jq -r '.deviceTypeIdentifier')"
  if [[ "${runtime}" != "${EXPECTED_RUNTIME}" || "${device_type}" != "${EXPECTED_DEVICE_TYPE}" ]]; then
    /bin/echo "Refusing: ${label} is not the fixed iPhone 17 Pro Max / iOS 26.4 device." >&2
    /bin/echo "${record}" >&2
    exit 2
  fi
}

validate_pair() {
  validate_device "Native" "${NATIVE_UDID}"
  validate_device "Expo" "${EXPO_UDID}"
}

booted_ids() {
  run_simctl list devices -j | /usr/bin/jq -r '.devices[][] | select(.state == "Booted") | .udid'
}

report_other_booted_devices() {
  local unexpected
  unexpected="$(booted_ids | /usr/bin/awk -v native="${NATIVE_UDID}" -v expo="${EXPO_UDID}" '$0 != native && $0 != expo')"
  if [[ -n "${unexpected}" ]]; then
    /bin/echo "Other agents currently have Booted simulators; this helper will not touch them:" >&2
    /bin/echo "${unexpected}" >&2
  fi
}

state_for() {
  device_record "$1" | /usr/bin/jq -r '.state'
}

require_pair_booted() {
  validate_pair
  report_other_booted_devices
  local native_state expo_state
  native_state="$(state_for "${NATIVE_UDID}")"
  expo_state="$(state_for "${EXPO_UDID}")"
  if [[ "${native_state}" != "Booted" || "${expo_state}" != "Booted" ]]; then
    /bin/echo "Refusing: fixed pair is not fully Booted (native=${native_state}, expo=${expo_state})." >&2
    exit 4
  fi
}

normalize_pair() {
  local appearance="${1:-light}"
  if [[ "${appearance}" != "light" && "${appearance}" != "dark" ]]; then
    /bin/echo "Appearance must be light or dark." >&2
    exit 64
  fi
  require_pair_booted
  /usr/bin/defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false
  local udid
  for udid in "${NATIVE_UDID}" "${EXPO_UDID}"; do
    run_simctl ui "${udid}" appearance "${appearance}"
    run_simctl status_bar "${udid}" override \
      --time "9:41" \
      --batteryState charged \
      --batteryLevel 100 \
      --wifiBars 3 \
      --cellularBars 4
  done
  /bin/echo "normalized appearance=${appearance} time=9:41 battery=100 wifi=3 cellular=4 hardware-keyboard=off"
}

boot_pair() {
  local appearance="${1:-light}"
  validate_pair
  report_other_booted_devices
  /usr/bin/open -a Simulator
  if [[ "$(state_for "${NATIVE_UDID}")" != "Booted" ]]; then
    run_simctl boot "${NATIVE_UDID}"
  fi
  if [[ "$(state_for "${EXPO_UDID}")" != "Booted" ]]; then
    run_simctl boot "${EXPO_UDID}"
  fi
  run_simctl bootstatus "${NATIVE_UDID}" -b
  run_simctl bootstatus "${EXPO_UDID}" -b
  normalize_pair "${appearance}"
  /bin/echo "fixed pair Booted; no additional simulator was created or started"
}

shutdown_pair() {
  validate_pair
  local udid
  for udid in "${NATIVE_UDID}" "${EXPO_UDID}"; do
    if [[ "$(state_for "${udid}")" == "Booted" ]]; then
      run_simctl shutdown "${udid}"
    fi
  done
  /bin/echo "fixed root pair Shutdown"
}

status_pair() {
  validate_pair
  /bin/echo "native=$(device_record "${NATIVE_UDID}")"
  /bin/echo "expo=$(device_record "${EXPO_UDID}")"
  local all_booted
  all_booted="$(booted_ids | /usr/bin/paste -sd, -)"
  /bin/echo "all_booted=${all_booted:-none}"
}

validate_token() {
  local label="$1"
  local value="$2"
  if [[ ! "${value}" =~ '^[a-z0-9][a-z0-9._-]*$' ]]; then
    /bin/echo "${label} must match [a-z0-9][a-z0-9._-]*" >&2
    exit 64
  fi
}

publish_capture() {
  local slug="$1"
  local state="$2"
  local comparison_dir="$3"
  local native_source="$4"
  local expo_source="$5"
  local verdict destination working_destination publish_dir
  verdict="$(/usr/bin/jq -r '.verdict' "${comparison_dir}/metrics.json")"
  if [[ "${verdict}" == "PASS" ]]; then
    destination="${PROJECT_DIR}/artifacts/acceptance/${slug}-current/states/${state}"
  else
    destination="${PROJECT_DIR}/artifacts/acceptance/${slug}-current/working/${state}"
  fi

  publish_dir="${CAPTURE_TMP}/publish"
  /bin/mkdir -p "${publish_dir}"
  /bin/cp "${native_source}" "${publish_dir}/native.png"
  /bin/cp "${expo_source}" "${publish_dir}/expo.png"
  /bin/cp "${comparison_dir}/diff-8x.png" "${publish_dir}/diff-8x.png"
  /bin/cp "${comparison_dir}/metrics.json" "${publish_dir}/metrics.json"

  /bin/mkdir -p "${destination}"
  /usr/bin/find "${destination}" -mindepth 1 -maxdepth 1 -type f -delete
  /bin/cp "${publish_dir}"/* "${destination}/"

  if [[ "${verdict}" == "PASS" ]]; then
    working_destination="${PROJECT_DIR}/artifacts/acceptance/${slug}-current/working/${state}"
    if [[ -d "${working_destination}" ]]; then
      /usr/bin/find "${working_destination}" -depth -delete
    fi
  fi

  /bin/echo "verdict=${verdict} evidence=${destination}"
  /usr/bin/shasum -a 256 \
    "${destination}/native.png" \
    "${destination}/expo.png" \
    "${destination}/diff-8x.png" \
    "${destination}/metrics.json"

  if [[ "${verdict}" != "PASS" ]]; then
    /bin/echo "Only the bounded current failure attempt was retained; it will be replaced on the next capture." >&2
    exit 5
  fi
}

capture_pair() {
  if [[ "$#" -lt 3 ]]; then
    usage >&2
    exit 64
  fi
  local slug="$1"
  local state="$2"
  local mode="$3"
  shift 3
  validate_token "slug" "${slug}"
  validate_token "state" "${state}"
  require_pair_booted

  CAPTURE_TMP="$(/usr/bin/mktemp -d /tmp/bwchat-parity-capture.XXXXXX)"
  local native_shot="${CAPTURE_TMP}/native.png"
  local expo_shot="${CAPTURE_TMP}/expo.png"
  local comparison_dir="${CAPTURE_TMP}/comparison"
  local native_source="${native_shot}"
  local expo_source="${expo_shot}"
  local python
  python="$(python_bin)"

  "${python}" -c 'import numpy, PIL' >/dev/null
  run_simctl io "${NATIVE_UDID}" screenshot --type=png "${native_shot}"
  run_simctl io "${EXPO_UDID}" screenshot --type=png "${expo_shot}"

  case "${mode}" in
    component)
      if [[ "$#" == "0" ]]; then
        "${python}" "${SCRIPT_DIR}/compare-component-style.py" \
          "${native_shot}" "${expo_shot}" "${comparison_dir}" \
          --minimum-ratio 0.95 >/dev/null
      elif [[ "$#" == "4" ]]; then
        "${python}" "${SCRIPT_DIR}/compare-component-style.py" \
          "${native_shot}" "${expo_shot}" "${comparison_dir}" \
          --minimum-ratio 0.95 --crop "$1" "$2" "$3" "$4" >/dev/null
        native_source="${comparison_dir}/native-crop.png"
        expo_source="${comparison_dir}/expo-crop.png"
      else
        /bin/echo "component mode accepts either no crop or x y width height." >&2
        exit 64
      fi
      ;;
    pixel)
      local tolerance="${1:-3}"
      if [[ "$#" -gt 1 || ! "${tolerance}" =~ '^[0-9]+$' || "${tolerance}" -gt 255 ]]; then
        /bin/echo "pixel mode accepts one tolerance from 0 to 255." >&2
        exit 64
      fi
      "${python}" "${SCRIPT_DIR}/compare-screenshots.py" \
        "${native_shot}" "${expo_shot}" "${comparison_dir}" \
        --minimum-ratio 0.95 --tolerance "${tolerance}" >/dev/null
      ;;
    *)
      /bin/echo "Mode must be component or pixel." >&2
      exit 64
      ;;
  esac

  publish_capture "${slug}" "${state}" "${comparison_dir}" "${native_source}" "${expo_source}"
}

case "${1:-}" in
  status)
    status_pair
    ;;
  boot)
    boot_pair "${2:-light}"
    ;;
  normalize)
    normalize_pair "${2:-light}"
    ;;
  shutdown)
    shutdown_pair
    ;;
  open-url)
    if [[ "$#" != "3" ]]; then
      usage >&2
      exit 64
    fi
    require_pair_booted
    case "$2" in
      native) run_simctl openurl "${NATIVE_UDID}" "$3" ;;
      expo) run_simctl openurl "${EXPO_UDID}" "$3" ;;
      *) /bin/echo "open-url target must be native or expo." >&2; exit 64 ;;
    esac
    ;;
  capture)
    shift
    if [[ "${1:-}" == "--" ]]; then
      shift
    fi
    capture_pair "$@"
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
