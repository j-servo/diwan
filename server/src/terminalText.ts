/**
 * Text that came from outside (a session label, an SDK error) is cleaned before it reaches the
 * terminal: ANSI/OSC escape sequences and control characters could rewrite the screen, forge a
 * log line, or hide what the line says.
 */
const OSC = /(?:\u001B\]|\u009D)[^\u0007\u001B\u009C]*(?:\u0007|\u001B\\|\u009C)?/g;
const CSI = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]?/g;
const ESC_OTHER = /\u001B[@-_]/g;
const CONTROLS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

export function terminalSafe(text: string): string {
  return text.replace(OSC, '').replace(CSI, '').replace(ESC_OTHER, '').replace(CONTROLS, ' ');
}
