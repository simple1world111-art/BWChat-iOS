#!/bin/zsh

set -eu

readonly LIVE_EXPO_UDID="B8892B82-E4CB-4BAE-A054-49573EBAD2A9"
readonly LIVE_EXPO_DEVICE_NAME="LiveLobby Expo Pair 26.4"
readonly LIVE_EXPO_WINDOW_TITLE="LiveLobby Expo Pair 26.4 – iOS 26.4"
readonly LIVE_EXPO_METRO_PORT="8085"
readonly XCODE_DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"

usage() {
  /bin/echo "Usage: $0 status|focus|open-metro|open-live"
  /bin/echo "This helper is fixed to ${LIVE_EXPO_DEVICE_NAME} (${LIVE_EXPO_UDID})."
}

run_simctl() {
  DEVELOPER_DIR="${XCODE_DEVELOPER_DIR}" /usr/bin/xcrun simctl "$@"
}

device_line() {
  run_simctl list devices | /usr/bin/awk -v udid="${LIVE_EXPO_UDID}" 'index($0, "(" udid ")") { print; exit }'
}

device_state() {
  local line
  line="$(device_line)"
  if [[ -z "${line}" ]]; then
    /bin/echo "Missing"
  elif [[ "${line}" == *"(Booted)"* ]]; then
    /bin/echo "Booted"
  elif [[ "${line}" == *"(Shutdown)"* ]]; then
    /bin/echo "Shutdown"
  else
    /bin/echo "Unknown"
  fi
}

require_booted() {
  local state
  state="$(device_state)"
  if [[ "${state}" != "Booted" ]]; then
    /bin/echo "Refusing: fixed LiveLobby Expo device is ${state}, not Booted." >&2
    exit 2
  fi
}

window_match_count() {
  /usr/bin/osascript <<'APPLESCRIPT'
property expectedWindowTitle : "LiveLobby Expo Pair 26.4 – iOS 26.4"

tell application "System Events"
  if not (exists process "Simulator") then return 0
  tell process "Simulator"
    return count of (windows whose name is expectedWindowTitle)
  end tell
end tell
APPLESCRIPT
}

focus_fixed_window() {
  require_booted
  /usr/bin/osascript <<'APPLESCRIPT'
property expectedWindowTitle : "LiveLobby Expo Pair 26.4 – iOS 26.4"

tell application "System Events"
  if not (exists process "Simulator") then error "Simulator is not running"
  tell process "Simulator"
    set matchingWindows to {}
    repeat with attempt from 1 to 50
      set matchingWindows to windows whose name is expectedWindowTitle
      if (count of matchingWindows) is 1 then exit repeat
      if attempt is 50 then
        error "Expected exactly one fixed LiveLobby Expo window, found " & (count of matchingWindows)
      end if
      delay 0.1
    end repeat

    set targetWindow to item 1 of matchingWindows
    set frontmost to true
    try
      set value of attribute "AXMain" of targetWindow to true
    end try
    perform action "AXRaise" of targetWindow

    repeat with attempt from 1 to 20
      if (count of windows) > 0 and name of front window is expectedWindowTitle then return
      delay 0.1
    end repeat
    error "Fixed LiveLobby Expo window did not become frontmost"
  end tell
end tell
APPLESCRIPT
}

open_metro() {
  require_booted
  local lan_host
  lan_host="$(/usr/sbin/ipconfig getifaddr en0 || true)"
  if [[ ! "${lan_host}" =~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' ]]; then
    /bin/echo "Refusing: no safe IPv4 address was found on en0." >&2
    exit 3
  fi

  run_simctl openurl "${LIVE_EXPO_UDID}" \
    "exp+bbchat://expo-development-client/?url=http%3A%2F%2F${lan_host}%3A${LIVE_EXPO_METRO_PORT}"
  focus_fixed_window
}

open_live_lobby() {
  require_booted
  run_simctl openurl "${LIVE_EXPO_UDID}" "bwchat://live-lobby"
  focus_fixed_window
}

case "${1:-}" in
  status)
    /bin/echo "udid=${LIVE_EXPO_UDID} state=$(device_state) window_matches=$(window_match_count)"
    ;;
  focus)
    focus_fixed_window
    ;;
  open-metro)
    open_metro
    ;;
  open-live)
    open_live_lobby
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
