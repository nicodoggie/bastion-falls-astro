import yml from "eslint-plugin-yml";

const yamlFiles = ["src/content/docs/world/**/*.{yaml,yml}"];
const maxLineLength = 100;

function getLineIndent(line) {
  return line.match(/^\s*/)[0].length;
}

function isIgnoredLongLine(line) {
  return /^https?:\/\/\S+$/.test(line.trim());
}

function wrapText(indent, text, maxLength) {
  const maxTextLength = maxLength - indent.length;

  if (maxTextLength <= 0 || !text.includes(" ")) {
    return [`${indent}${text}`];
  }

  const wrapped = [];
  let current = "";

  for (const word of text.split(/\s+/)) {
    if (!current) {
      current = word;
      continue;
    }

    if (current.length + 1 + word.length > maxTextLength) {
      wrapped.push(`${indent}${current}`);
      current = word;
      continue;
    }

    current = `${current} ${word}`;
  }

  if (current) {
    wrapped.push(`${indent}${current}`);
  }

  return wrapped.length > 0 ? wrapped : [`${indent}${text}`];
}

function wrapBlockScalarContent(lines, maxLength) {
  const wrapped = [];
  let paragraphIndent = "";
  let paragraphLines = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    wrapped.push(
      ...wrapText(
        paragraphIndent,
        paragraphLines
          .map((line) => line.slice(paragraphIndent.length).trim())
          .join(" "),
        maxLength,
      ),
    );

    paragraphIndent = "";
    paragraphLines = [];
  };

  for (const line of lines) {
    if (line.trim() === "" || isIgnoredLongLine(line)) {
      flushParagraph();
      wrapped.push(line.trimEnd());
      continue;
    }

    const indent = line.slice(0, getLineIndent(line));
    const text = line.slice(indent.length).trim();
    const isHardBreak =
      /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text) || /^\|/.test(text);

    if (isHardBreak) {
      flushParagraph();
      wrapped.push(...wrapText(indent, text, maxLength));
      continue;
    }

    if (paragraphLines.length > 0 && indent !== paragraphIndent) {
      flushParagraph();
    }

    paragraphIndent = indent;
    paragraphLines.push(line);
  }

  flushParagraph();

  return wrapped;
}

function getLineStartOffsets(text) {
  const offsets = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      offsets.push(index + 1);
    }
  }

  return offsets;
}

const blockScalarLineLength = {
  meta: {
    type: "layout",
    fixable: "whitespace",
    docs: {
      description: "wrap YAML block scalar lines",
    },
    messages: {
      normalizeBlockScalar:
        "Normalize block scalar content lines to 100 columns or fewer.",
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const lineStartOffsets = getLineStartOffsets(sourceCode.text);

    return {
      YAMLScalar(node) {
        if (node.style !== "literal" && node.style !== "folded") {
          return;
        }

        const contentStartLine = node.loc.start.line;
        const contentEndLine = node.loc.end.line - 1;

        if (contentStartLine > contentEndLine) {
          return;
        }

        const contentLines = sourceCode.lines.slice(
          contentStartLine,
          contentEndLine + 1,
        );
        const firstChangedLineIndex = contentLines.findIndex(
          (line) => line.length > maxLineLength && !isIgnoredLongLine(line),
        );
        const replacementLines = wrapBlockScalarContent(
          contentLines,
          maxLineLength,
        );
        const original = contentLines.join("\n");
        const replacement = replacementLines.join("\n");
        const reportLineIndex =
          firstChangedLineIndex === -1
            ? contentLines.findIndex(
                (line, index) => line !== replacementLines[index],
              )
            : firstChangedLineIndex;

        if (replacement === original || reportLineIndex === -1) {
          return;
        }

        context.report({
          node,
          loc: {
            start: {
              line: contentStartLine + reportLineIndex + 1,
              column: maxLineLength,
            },
            end: {
              line: contentStartLine + reportLineIndex + 1,
              column: contentLines[reportLineIndex].length,
            },
          },
          messageId: "normalizeBlockScalar",
          fix(fixer) {
            const rangeStart = lineStartOffsets[contentStartLine];
            const rangeEnd = node.range[1];

            return fixer.replaceTextRange([rangeStart, rangeEnd], replacement);
          },
        });
      },
    };
  },
};

export default [
  ...yml.configs["flat/standard"],
  {
    files: yamlFiles,
    plugins: {
      "bf-yaml": {
        rules: {
          "block-scalar-line-length": blockScalarLineLength,
        },
      },
    },
    rules: {
      "max-len": [
        "error",
        {
          code: maxLineLength,
          tabWidth: 2,
          ignoreComments: true,
          ignoreUrls: true,
        },
      ],
      "bf-yaml/block-scalar-line-length": "error",
      "yml/indent": ["error", 2],
      "yml/plain-scalar": "off",
    },
  },
];
