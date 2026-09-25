/**
 * Never log credentials. The OpenCode service password and the module token are
 * passed to `redact` and replaced before any line reaches stdout/stderr/log file.
 */
const SECRET_KEYS = ["password", "token", "secret", "authorization", "apiKey", "api_key"];

export class Log {
  private secrets: string[] = [];

  constructor(
    private readonly sink: (line: string) => void = (line) => process.stderr.write(line + "\n"),
    private readonly now: () => number = () => Date.now(),
  ) {}

  addSecret(value: string | undefined | null): void {
    const v = (value ?? "").trim();
    if (v.length >= 4) this.secrets.push(v);
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) out = out.split(secret).join("***");
    // Defensive: scrub basic-auth material even if the secret was not registered.
    out = out.replace(/(Authorization:\s*Basic\s+)[A-Za-z0-9+/=]+/gi, "$1***");
    return out;
  }

  line(level: "info" | "warn" | "error", message: string): void {
    const stamp = new Date(this.now()).toISOString();
    this.sink(`opencode.depth ${stamp} ${level} ${this.redact(message)}`);
  }

  info(message: string): void {
    this.line("info", message);
  }

  warn(message: string): void {
    this.line("warn", message);
  }

  error(message: string): void {
    this.line("error", message);
  }
}
