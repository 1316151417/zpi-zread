/** 极简控制台日志：支持 ANSI 颜色与嵌套前缀。 */

export class Log {
  private prefix = "";
  usePrefix(prefix: string) {
    this.prefix = prefix;
  }
  info(message: string) {
    this.write(`${dim(this.prefix)}${message}`);
  }
  tool(name: string, detail: string) {
    this.write(`${dim(this.prefix)}  ${dim("→")} ${name} ${dim(detail)}`);
  }
  ok(message: string) {
    this.write(`${dim(this.prefix)}${green(message)}`);
  }
  fail(message: string) {
    this.write(`${dim(this.prefix)}${red(message)}`);
  }
  rule(title: string) {
    this.write(`\n${cyan("=".repeat(60))}\n${cyan(title)}\n${cyan("=".repeat(60))}`);
  }
  private write(line: string) {
    process.stdout.write(line + "\n");
  }
}

const enableColor = process.stdout.isTTY && !process.env.NO_COLOR;

function color(code: string, text: string): string {
  return enableColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}
export const dim = (t: string) => color("2", t);
export const green = (t: string) => color("32", t);
export const red = (t: string) => color("31", t);
export const cyan = (t: string) => color("36", t);
export const yellow = (t: string) => color("33", t);
