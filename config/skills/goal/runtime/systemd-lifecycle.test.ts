import { describe, expect, test } from "bun:test";

import {
  SystemdLifecycleError,
  assertUnitName,
  environmentNamesForUnit,
  newUnitName,
  readUnitCgroup,
} from "./systemd-lifecycle";

describe("systemd lifecycle boundaries", () => {
  test("rejects foreign unit identities", () => {
    for (const unit of ["other.service", "../work-plans-h2h-12345678.service", "work-plans-h2h-12345678.socket"]) {
      expect(() => assertUnitName(unit)).toThrow(SystemdLifecycleError);
    }
  });

  test("copies environment names only and excludes manager variables", () => {
    const names = environmentNamesForUnit({
      PATH: "/bin",
      HOME: "/home/x",
      SECRET_VALUE: "not-in-argv",
      INVOCATION_ID: "parent",
      NOTIFY_SOCKET: "/run/notify",
      LISTEN_FDS: "1",
      WORK_PLANS_H2H_ROLE: "ignored",
    } as NodeJS.ProcessEnv);
    expect(names).toContain("PATH");
    expect(names).toContain("HOME");
    expect(names).toContain("SECRET_VALUE");
    expect(names).toContain("WORK_PLANS_H2H_ROLE");
    expect(names).not.toContain("INVOCATION_ID");
    expect(names).not.toContain("NOTIFY_SOCKET");
    expect(names).not.toContain("LISTEN_FDS");
  });


  test("rejects invalid unit and control-group paths", async () => {
    await expect(readUnitCgroup("/user.slice/other.service", newUnitName())).rejects.toThrow(
      SystemdLifecycleError,
    );
    const unit = newUnitName();
    const missing = await readUnitCgroup(`/user.slice/${unit}`, unit);
    expect(missing.present).toBe(false);
    expect(missing.populated).toBe(false);
  });
});
