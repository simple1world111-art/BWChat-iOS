import fs from "node:fs";
import path from "node:path";

const scriptPath = path.join(process.cwd(), "scripts/live-lobby-fixed-simulator.sh");
const source = fs.readFileSync(scriptPath, "utf8");

describe("fixed LiveLobby Simulator acceptance helper", () => {
  it("is pinned to the approved Expo device, window, Metro port, and route", () => {
    expect(source).toContain('readonly LIVE_EXPO_UDID="B8892B82-E4CB-4BAE-A054-49573EBAD2A9"');
    expect(source).toContain('readonly LIVE_EXPO_WINDOW_TITLE="LiveLobby Expo Pair 26.4 – iOS 26.4"');
    expect(source).toContain('readonly LIVE_EXPO_METRO_PORT="8085"');
    expect(source).toContain('"bwchat://live-lobby"');
    expect(source).toContain('windows whose name is expectedWindowTitle');
    expect(source).toContain('perform action "AXRaise" of targetWindow');
    expect(source).toContain("repeat with attempt from 1 to 50");
    expect(source).toContain("repeat with attempt from 1 to 20");
  });

  it("refuses to operate when the exact fixed device is not booted", () => {
    expect(source).toContain('if [[ "${state}" != "Booted" ]]');
    expect(source).toContain('Refusing: fixed LiveLobby Expo device is ${state}, not Booted.');
    expect(source).toContain('if (count of matchingWindows) is 1 then exit repeat');
    expect(source).toContain('error "Expected exactly one fixed LiveLobby Expo window, found "');
  });

  it("cannot boot, install, launch, erase, or delete any simulator", () => {
    expect(source).not.toMatch(/run_simctl\s+(boot|bootstatus|install|launch|erase|delete|shutdown)\b/);
    expect(source).not.toMatch(/simctl\s+(boot|bootstatus|install|launch|erase|delete|shutdown)\b/);
    expect(source).not.toContain("CurrentDeviceUDID");
  });

  it("does not accept or persist credentials", () => {
    expect(source).not.toMatch(/password|passwd|credential|token|keychain|security\s+add/i);
    expect(source).not.toMatch(/\$\{[2-9](?::-[^}]*)?\}/);
    expect(source).not.toMatch(/defaults\s+write|pbcopy|pasteboard/i);
  });

  it("constructs only the fixed LAN Metro URL and validates the host", () => {
    expect(source).toContain("/usr/sbin/ipconfig getifaddr en0");
    expect(source).toContain("'^[0-9]{1,3}(\\.[0-9]{1,3}){3}$'");
    expect(source).toContain(
      '"exp+bbchat://expo-development-client/?url=http%3A%2F%2F${lan_host}%3A${LIVE_EXPO_METRO_PORT}"',
    );
  });
});
