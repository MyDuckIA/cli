const ANSI_RESET = "\x1b[0m";
const ANSI_YELLOW = "\x1b[38;5;226m";
const ANSI_ORANGE = "\x1b[38;5;208m";
const ANSI_BLACK = "\x1b[30m";

const DUCK_LINES = [
  "                                                  ",
  "                         :--                      ",
  "                      -:::----                    ",
  "                     -:::::----                   ",
  "                    -::::::--O---++++             ",
  "                    -:::::::-----==+              ",
  "                    --::::::-----=+               ",
  "                    ----:--------                 ",
  "                     -----------                  ",
  "                       ---------                  ",
  "          .::          -----------                ",
  "          :::::  -------:::----------             ",
  "          ::::--------::::::---------:            ",
  "          -::::----:::::::::----------:           ",
  "          -::::::::::-----------------::          ",
  "           ::::::::::::::--------------:          ",
  "           :::::::::::::::::-----------           ",
  "             ::::::::::---------------            ",
  "               .-------------------:              ",
  "                                                  ",
];

function isBeakChar(char) {
  return char === "+" || char === "=" || char === "*";
}

function isEyeChar(char) {
  return char === "O";
}

export function renderMyDuckAscii({ color = false } = {}) {
  return DUCK_LINES
    .map((line) => {
      let row = "";
      let activeColor = "";

      for (let column = 0; column < line.length; column += 1) {
        const char = line[column];
        if (char === " ") {
          if (color && activeColor) {
            row += ANSI_RESET;
            activeColor = "";
          }
          row += " ";
          continue;
        }

        const cellColor = isEyeChar(char)
          ? ANSI_BLACK
          : (isBeakChar(char) ? ANSI_ORANGE : ANSI_YELLOW);

        if (!color) {
          row += char;
          continue;
        }

        if (activeColor !== cellColor) {
          row += cellColor;
          activeColor = cellColor;
        }
        row += "█";
      }

      if (color && activeColor) {
        row += ANSI_RESET;
      }

      return row;
    })
    .join("\n");
}

export const MY_DUCK_ASCII = renderMyDuckAscii();
