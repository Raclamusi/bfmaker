
(function () {
  "use strict";

  const input = document.getElementById("input");
  const output = document.getElementById("output");
  const eofOption = document.getElementsByName("eof");
  const grOption = document.getElementsByName("gr");
  const stackOption = document.getElementById("stack");
  const commentOption = document.getElementsByName("comment");

  if (!("bfmaker_input" in localStorage)) {
    localStorage.setItem("bfmaker_input", JSON.stringify(
`; 入力文字列を3回出力
ECHO3    START
         IN    BUF,LEN
         LD    GR0,=3
LOOP     OUT   BUF,LEN
         SUBL  GR0,=1
         JNZ   LOOP
         RET
LEN      DS    1
BUF      DS    256
         END
`
    ));
  }
  if (!("bfmaker_option" in localStorage)) {
    localStorage.setItem("bfmaker_option", JSON.stringify({
      eof: "-1", gr: "8", stack: 64, comment: "enabled",
    }));
  }

  input.value = JSON.parse(localStorage.getItem("bfmaker_input"));
  /** @type {{ eof: "-1" | "0"; gr: "8" | "16"; stack: number; comment: "enabled" | "disabled"; }} */
  const option = JSON.parse(localStorage.getItem("bfmaker_option"));
  Array.from(eofOption).find(e => e.value === option.eof).checked = true;
  Array.from(grOption).find(e => e.value === option.gr).checked = true;
  option.stack = parseInt(option.stack);
  Array.from(commentOption).find(e => e.value === option.comment).checked = true;

  stackOption.addEventListener("change", e => {
    if (e.target.value.match(/^\d+$/) === null || parseInt(e.target.value) < 2) {
      alert("スタック領域サイズは 2 以上の整数である必要があります。");
      e.target.value = option.stack;
    }
    else {
      option.stack = parseInt(e.target.value);
    }
  });

  document.getElementById("compile").addEventListener("click", () => {
    option.eof = Array.from(eofOption).find(e => e.checked).value;
    option.gr = Array.from(grOption).find(e => e.checked).value;
    option.comment = Array.from(commentOption).find(e => e.checked).value;

    localStorage.setItem("bfmaker_input", JSON.stringify(input.value));
    localStorage.setItem("bfmaker_option", JSON.stringify(option));

    const isGR = operand => operand.match(option.gr === "16" ? /^GR([0-9]|1[0-5])$/i : /^GR[0-7]$/i) !== null;
    const isNaturalNumber = operand => operand.match(/^\d+$/) !== null;
    const isDec = operand => operand.match(/^-?\d+$/) !== null;
    const isHex = operand => operand.match(/^#[\dA-F]+$/i) !== null;
    const isLabel = operand => operand.match(/^[A-Z_][_\w]*$/i) !== null && !isGR(operand);
    const isAddress = operand => isLabel(operand) || operand.match(/^(=?-?\d+|=?#[\dA-F]+|='([^']|'')*')$/i) !== null;
    const isString = operand => operand.match(/^'([^']|'')*'$/) !== null;
    const isData = operand => isLabel(operand) || isDec(operand) || isHex(operand) || isString(operand);
    const toValidNumber = number => number + 0x10000 * -Math.floor(number / 0x10000)
    const fromGR = operand => parseInt(operand.slice(2));
    const fromAddress = (operand, table) => {
      const adr = isDec(operand) ? toValidNumber(parseInt(operand)) : isHex(operand) ? toValidNumber(parseInt(operand.slice(1), 16)) : operand in table ? table[operand] : -1;
      return [adr >> 8, adr & 0xff];
    };
    const noOperands = {
      check: operands => operands.length === 0,
      convert: (operands, table) => [0x00],
    };
    const grAddressOperands = {
      check: operands => operands.length === 3 && [isGR, isAddress, isGR].every((f, i) => f(operands[i])) || operands.length === 2 && [isGR, isAddress].every((f, i) => f(operands[i])),
      convert: (operands, table) => [(fromGR(operands[0]) << 4) | (operands.length === 2 ? 0 : fromGR(operands[2])), ...fromAddress(operands[1], table)],
    };
    const grOperands = {
      check: operands => operands.length === 1 && isGR(operands[0]),
      convert: (operands, table) => [fromGR(operands[0]) << 4],
    };
    const grGrOperands = {
      check: operands => operands.length === 2 && [isGR, isGR].every((f, i) => f(operands[i])),
      convert: (operands, table) => [(fromGR(operands[0]) << 4) | fromGR(operands[1])],
    };
    const addressOperands = {
      check: operands => operands.length === 2 && [isAddress, isGR].every((f, i) => f(operands[i])) || operands.length === 1 && isAddress(operands[0]),
      convert: (operands, table) => [operands.length === 1 ? 0 : fromGR(operands[1]), ...fromAddress(operands[0], table)],
    };
    const startOperands = {
      check: operands => operands.length === 1 && isLabel(operands[0]) || operands.length === 0,
      convert: (operands, table) => [],
    };
    const endOperands = {
      check: operands => operands.length === 0,
      convert: (operands, table) => [],
    };
    const dsOperands = {
      check: operands => operands.length === 1 && isNaturalNumber(operands[0]),
      convert: (operands, table) => new Array(toValidNumber(parseInt(operands[0])) * 2).fill(0),
    };
    const dcOperands = {
      check: operands => operands.length >= 1 && operands.every(e => isData(e)),
      convert: (operands, table) => operands.map(operand => {
        if (isAddress(operand)) return fromAddress(operand, table);
        if (isString(operand)) return Array.from(unescape(encodeURIComponent(operand.slice(1, -1).replace(/''/g, "'")))).map(c => [0, c.charCodeAt(0)]).flat();
        return [];
      }).flat(),
    };
    const inOutOperands = adr => { return {
      check: operands => operands.length == 2 && [isAddress, isAddress].every((f, i) => f(operands[i])),
      convert: (operands, table) => [
        0x70, 0x01, 0x00, 0x00,
        0x70, 0x02, 0x00, 0x00,
        0x12, 0x10, ...fromAddress(operands[0], table), 0x12, 0x20, ...fromAddress(operands[1], table),
        0xf0, 0x00, adr >> 8, adr & 0xff,
        0x71, 0x20,
        0x71, 0x10
      ],
    }; };
    const rpushOperands = {
      check: operands => operands.length === 0,
      convert: (operands, table) => new Array(option.gr === "16" ? 15 : 7).fill(0).map((_, i) => [0x70, i + 1, 0x00, 0x00]).flat(),
    };
    const rpopOperands = {
      check: operands => operands.length === 0,
      convert: (operands, table) => new Array(option.gr === "16" ? 15 : 7).fill(0).map((_, i) => i + 1).reverse().map(i => [0x71, i << 4]).flat(),
    };
    const opcodeTable = {
      NOP: [
        { binary: [0x00], operands: noOperands },
      ],
      LD: [
        { binary: [0x10], operands: grAddressOperands },
        { binary: [0x14], operands: grGrOperands },
      ],
      ST: [
        { binary: [0x11], operands: grAddressOperands },
      ],
      LAD: [
        { binary: [0x12], operands: grAddressOperands },
      ],
      ADDA: [
        { binary: [0x20], operands: grAddressOperands },
        { binary: [0x24], operands: grGrOperands },
      ],
      SUBA: [
        { binary: [0x21], operands: grAddressOperands },
        { binary: [0x25], operands: grGrOperands },
      ],
      ADDL: [
        { binary: [0x22], operands: grAddressOperands },
        { binary: [0x26], operands: grGrOperands },
      ],
      SUBL: [
        { binary: [0x23], operands: grAddressOperands },
        { binary: [0x27], operands: grGrOperands },
      ],
      AND: [
        { binary: [0x30], operands: grAddressOperands },
        { binary: [0x34], operands: grGrOperands },
      ],
      OR: [
        { binary: [0x31], operands: grAddressOperands },
        { binary: [0x35], operands: grGrOperands },
      ],
      XOR: [
        { binary: [0x32], operands: grAddressOperands },
        { binary: [0x36], operands: grGrOperands },
      ],
      CPA: [
        { binary: [0x40], operands: grAddressOperands },
        { binary: [0x44], operands: grGrOperands },
      ],
      CPL: [
        { binary: [0x41], operands: grAddressOperands },
        { binary: [0x45], operands: grGrOperands },
      ],
      SLA: [
        { binary: [0x50], operands: grAddressOperands },
      ],
      SRA: [
        { binary: [0x51], operands: grAddressOperands },
      ],
      SLL: [
        { binary: [0x52], operands: grAddressOperands },
      ],
      SRL: [
        { binary: [0x53], operands: grAddressOperands },
      ],
      JMI: [
        { binary: [0x61], operands: addressOperands },
      ],
      JNZ: [
        { binary: [0x62], operands: addressOperands },
      ],
      JZE: [
        { binary: [0x63], operands: addressOperands },
      ],
      JUMP: [
        { binary: [0x64], operands: addressOperands },
      ],
      JPL: [
        { binary: [0x65], operands: addressOperands },
      ],
      JOV: [
        { binary: [0x66], operands: addressOperands },
      ],
      PUSH: [
        { binary: [0x70], operands: addressOperands },
      ],
      POP: [
        { binary: [0x71], operands: grOperands },
      ],
      CALL: [
        { binary: [0x80], operands: addressOperands },
      ],
      RET: [
        { binary: [0x81], operands: noOperands },
      ],
      SVC: [
        { binary: 0xf0, operands: addressOperands },
      ],
      START: [
        { binary: [], operands: startOperands },
      ],
      END: [
        { binary: [], operands: endOperands },
      ],
      DS: [
        { binary: [], operands: dsOperands },
      ],
      DC: [
        { binary: [], operands: dcOperands },
      ],
      IN: [
        { binary: [], operands: inOutOperands(1) },
      ],
      OUT: [
        { binary: [], operands: inOutOperands(2) },
      ],
      RPUSH: [
        { binary: [], operands: rpushOperands },
      ],
      RPOP: [
        { binary: [], operands: rpopOperands },
      ],
    };

    const compile = () => {
      try {
        /** @type {string} */
        const source = input.value;

        const syntaxCheck = source.split("\n").map(
          line => line.match(/^(?:(?<label>[A-Z]\w*)?\s+(?<opcode>[A-Z]+)(?:\s+(?<operands>(?:[^,;'\s]|'[^']*?')+(?:\s*,\s*(?:[^,;'\s]|'[^']*?')+)*)(?:[;\s].*)?|\s*(?:;.*)?)|\s*(?:;.*)?)$/i) ?? line
        );
        {
          const msg = syntaxCheck.reduce((msg, cur, idx) => msg + (cur instanceof Object ? "" : `エラー: 行 ${idx+1}: 構文が正しくありません。\n    ${cur}\n\n`), "");
          if (msg !== "") return [null, msg];
        }
        /** @type {{ input: string; index: number; label: string; opcode: string; operands: string[]; }[]} */
        const lineData = syntaxCheck.map((match, idx) =>  {
          return { input: match.input, index: idx, label: (match.groups.label ?? ""), opcode: (match.groups.opcode ?? "").toUpperCase(), operands: (match.groups.operands === undefined ? [] : match.groups.operands.match(/(?:[^,;'\s]|'[^']*?')+/g)) };
        });
        {
          const msg = lineData.filter(line => line.opcode !== "").reduce((msg, line) => {
            if (!(line.opcode in opcodeTable)) return msg + `エラー: 行 ${line.index+1}: 命令コード ${line.opcode} は登録されていません。\n    ${line.input}\n\n`;
            if (line.opcode === "START" && line.label === "") msg += `エラー: 行 ${line.index+1}: START のラベルは必須です。\n    ${line.input}\n\n`;
            if (line.opcode === "END" && line.label !== "") msg += `エラー: 行 ${line.index+1}: END にラベルをつけることはできません。\n    ${line.input}\n\n`;
            if (!opcodeTable[line.opcode].some(opcode => opcode.operands.check(line.operands)))
              return msg + `エラー: 行 ${line.index+1}: オペランドが正しくありません。\n    ${line.input}\n\n`;
            return msg;
          }, "");
          if (msg !== "") return [null, msg];
        }
        /** @type {{ input: string; index: number; label: string; opcode: string; operands: string[]; }[][]} */
        const programs = [];
        {
          let msg = "";
          let start = 0;
          for (let end = lineData.findIndex(e => e.opcode === "END"); end !== -1; end = lineData.slice(start).findIndex(e => e.opcode === "END")) {
            const program = lineData.slice(start, start+end+1);
            const starts = program.filter(e => e.opcode === "START");
            if (starts.length !== 1) {
              const lines = starts.length >= 2 ? starts.slice(1) : [lineData[start+end]];
              msg += lines.reduce((msg, line) => msg + `エラー: 行 ${line.index+1}: START と END の対応が正しくありません。\n    ${line.input}\n\n`, "");
            }
            else {
              msg += program.slice(0, starts[0].index - start).filter(e => e.opcode !== "").reduce((msg, line) => msg + `エラー: 行 ${line.index}: START と END の間でない行に命令を置くことはできません。\n    ${line.input}\n\n`, "");
            }
            programs.push(program);
            start += end + 1;
          }
          const program = lineData.slice(start);
          msg += program.reduce((msg, line) => {
            if (line.opcode === "START") return msg + `エラー: 行 ${line.index+1}: START と END の対応が正しくありません。\n    ${line.input}\n\n`;
            if (line.opcode !== "") return msg + `エラー: 行 ${line.index+1}: START と END の間でない行に命令を置くことはできません。\n    ${line.input}\n\n`;
            return msg;
          }, "");
          if (programs.length === 0 && program.find(e => e.opcode === "START") === undefined) msg += "エラー: START が 1 つ以上必要です。\n\n";
          programs.push(program);
          if (msg !== "") return [null, msg];
        }
        const programsAddingDc = programs.slice(0, -1).map(
          program => [...program.slice(0, -1), ...program.reduce(
            (table, line) => line.operands.reduce(
              (table, operand) => operand[0] === "=" && !table.includes(operand) ? [...table, operand] : table
            , table)
          , []).map(
            literal => { return { input: `( DC ${literal.slice(1)}  ; リテラルから自動生成された DC 命令 )`, index: -1, label: literal, opcode: "DC", operands: [literal.slice(1)] }; }
          ), program[program.length - 1]]
        );
        const programEnd = programs[programs.length - 1];
        let binaryOffset = 0;
        const programsWithBinary = programsAddingDc.map(program => program.map(line => {
          if (line.opcode === "") return { lineData: line, opcode: null, binary: [], offset: binaryOffset };
          const opcode = opcodeTable[line.opcode].find(e => e.operands.check(line.operands));
          const binary = [...opcode.binary, ...opcode.operands.convert(line.operands, {})];
          const offset = binaryOffset;
          binaryOffset += binary.length / 2;
          return { lineData: line, opcode: opcode, binary: binary, offset: offset };
        }));
        if (binaryOffset > 0x10000) {
          return [null, "エラー: プログラムのサイズが 16 ビットで扱えるサイズを超えています。\n\n"];
        }
        const programsWithLabelTable = programsWithBinary.map(program => {
          const labelTable = program.reduce((table, line) => {
            if (line.lineData.label === "") return table;
            table[line.lineData.label] = line.lineData.label in table ? null : line.offset;
            return table;
          }, {});
          const start = program.find(e => e.lineData.opcode === "START");
          if (start.lineData.operands.length === 1) {
            start.offset = labelTable[start.lineData.operands[0]];
            labelTable[start.lineData.label] = start.offset;
          }
          return {
            program: program,
            start: start,
            labelTable: labelTable,
          };
        });
        {
          let msg = "";
          msg += programsWithLabelTable.reduce(
            (msg, program) => program.start.offset === undefined ? msg + `エラー: 行 ${program.start.index+1}: ラベル ${program.start.operands[0]} が定義されていません。\n    ${program.start.input}\n\n` : msg
          , "");
          msg += programsWithLabelTable.reduce(
            (msg, program) => Object.entries(program.labelTable).filter(([k, v]) => v === null).reduce(
              (msg, [label, offset]) => program.program.filter(e => e.lineData.label === label).reduce(
                (msg, line) => msg + `エラー: 行 ${line.lineData.index+1}: ラベル ${label} が重複しています。\n    ${line.lineData.input}\n\n`
              , msg)
            , msg)
          , "");
          if (msg !== "") return [null, msg];
        }
        const globalLabelTable = programsWithLabelTable.reduce((table, program) => {
          table[program.start.lineData.label] = program.start.lineData.label in table ? null : program.start.offset;
          return table;
        }, {});
        {
          const msg = Object.entries(globalLabelTable).filter(([k, v]) => v === null).reduce(
            (msg, [label, offset]) => programsWithLabelTable.filter(e => e.start.lineData.label === label).reduce(
              (msg, program) => msg + `エラー: 行 ${program.start.lineData.index+1}: ラベル ${label} が重複しています。\n    ${program.start.lineData.input}\n\n`
            , msg)
          , "");
          if (msg !== "") return [null, msg];
        }
        const compiledProgram = [
          ...programsWithLabelTable.map(program => {
            const labelTable = {
              ...globalLabelTable,
              ...program.labelTable,
            };
            return program.program.map(line => {
              if (line.binary.length !== 0) line.binary = [...line.opcode.binary, ...line.opcode.operands.convert(line.lineData.operands, labelTable)];
              return line;
            });
          }).flat(),
          ...programEnd.map(line => {
            return { lineData: line, opcode: "", binary: [], offset: binaryOffset };
          }),
        ];
        {
          const msg = compiledProgram.reduce(
            (msg, line) => line.binary.find(e => e === -1) === undefined ? msg : msg + `エラー: 行 ${line.lineData.index+1}: オペランドに使用されているラベルが定義されていません。\n    ${line.lineData.input}\n\n`
          , "");
          if (msg !== "") return [null, msg];
        }

        const code =
`
# ==========
# メモリ初期化
# ==========

# スタック領域
${(">>> ".repeat(15) + ">>>\n").repeat(Math.floor((option.stack - 2) / 16)) + ">>> ".repeat((option.stack - 2) % 16 + 1).trim()}
+>->-> >>

# 汎用レジスタ (GR)
#   ${option.gr === "16" ? "GR15 GR14" : "GR7 GR6"} … GR0
${(">>>>>>>>>>>>>>>> >> ".repeat(4).trim() + "\n").repeat(option.gr === "16" ? 4 : 2).trim()}

# フラグレジスタ (FR)
#   OF SF ZF
> > >

# 演算用領域
>>>>>>>>>>>>>>>>>>>>

# 命令レジスタ (IR)
>>>>>>>> >>

# 実行フラグ
+>

# プログラムレジスタ (PR)
${
  (() => {
    const pr = programsWithLabelTable[0].start.offset;
    return `${"++++++++++++++++ ".repeat(pr >> 12)}${"+".repeat(pr >> 8 & 0x0f)} >\n${"++++++++++++++++ ".repeat(pr >> 4 & 0x0f)}${"+".repeat(pr & 0x0f)} >`;
  })()
}

# メモリアドレスレジスタ (MAR)
>> >>

# 主記憶領域

${
  compiledProgram.reduce((code, line) => {
    if (line.binary.length === 0) return code + `# ${line.lineData.input}\n`;
    return code +
      `# ${line.lineData.input.replace(/\+/g, "＋").replace(/-/g, "－").replace(/>/g, "＞").replace(/</g, "＜").replace(/\[/g, "［").replace(/]/g, "］").replace(/,/g, "，").replace(/\./g, "．").replace(/@/g, "＠")}\n` +
      `#   ${("0000" + line.offset.toString(16)).slice(-4)}:${line.binary.reduce((acc, cur) => acc + " " + ("00" + cur.toString(16)).slice(-2), "")}\n` +
      line.binary.reduce(
        (code, b, i) => code +
          (i % 2 == 0 ? `${line.offset < programsWithLabelTable[0].start.offset ? "+" : ""}>+>\n` : "") +
          `${"++++++++++++++++ ".repeat(b >> 4)}${"+".repeat(b & 0x0f)} >\n`
      , "")
  }, "")
}

# 実行フラグへ移動
<<<[-<<<<]<<<<


# ==========
# 命令サイクル
# ==========

[
  # オペコードの位置へ移動
  >>> >>>>[>>>>] >>

  # オペコード上位 8 ビットを IR にコピー
  [-
    >>+<<
    << <<<<[<<<<] <<<<<
    <[<]+>[->]
    >>>>> >>>>[>>>>] >>
  ]
  >>[-<<+>>]<

  # オペコード下位 8 ビットを演算用領域にコピー
  [-
    >+<
    <<< <<<<[<<<<] <<<<<<<<<<<<<<
    <[<]+>[->]
    >>>>>>>>>>>>>> >>>>[>>>>] >>>
  ]
  >[-<+>]

  # 演算用領域へ移動
  <<<< <<<<[<<<<] <<<<<<<<<<<<<<

  # レジスタの番号を計算
  <[- >>>>>>>>>> >+< <<<<<<<<<< ]
  <[-> >>>>>>>>>> >++< <<<<<<<<<< <]
  <[->> >>>>>>>>>> >++++< <<<<<<<<<< <<]
  <[-${option.gr === "16" ? ">>> >>>>>>>>>> >++++++++< <<<<<<<<<< <<<" : ""}]
  <[->>>> >>>>>>>>>> + <<<<<<<<<< <<<<]
  <[->>>>> >>>>>>>>>> ++ <<<<<<<<<< <<<<<]
  <[->>>>>> >>>>>>>>>> ++++ <<<<<<<<<< <<<<<<]
  <[-${option.gr === "16" ? ">>>>>>> >>>>>>>>>> ++++++++ <<<<<<<<<< <<<<<<<" : ""}]

  # IR へ移動
  >>>>>>>

  # オペコードで分岐
  >+>-[+<-  # 0*** ****
    >+>-[+<-  # 00** ****
      >+>-[+<-  # 000* ****
        >>[-  # 0001 ****
          >-[+  # 0001 0***
            +>-[+<-  # 0001 00**
              >+>-[+<-  # 0001 000*
                # x の指定があれば、 x の値を演算用領域にコピー
                >>>>[
                  # GR に x までのフラグを配置
                  [-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域にフラグをセット
                  <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # x へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # x の値を演算用領域にコピー
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>]+<-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+<+
                      [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>] <-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +<[->-<]<
                  ]
                  >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                  # GR のフラグをリセット
                  >[->>>>>>>>>>>>>>>>>>]
                  # 演算用領域の値を圧縮
                  >>>>>>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [->>>>++++++++++++++++<<<<]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [->>>>++++++++++++++++<<<<]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>
                ]
                # PR に 1 だけ加算
                >>>> +<+[>-]>[-<<+>>>]
                # adr へ移動
                >>>[>>>>]+>>>> >>
                # adr を演算用領域にコピー
                [-
                  >>+<<
                  << <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<<<<<<<<+
                  >>>>>>>>>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >>
                ]
                >>[-<<+>>]<
                [-
                  >+<
                  <<< <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<<<<<<<+
                  >>>>>>>>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >>>
                ]
                >[-<+>]
                # 演算用領域へ移動
                <<<< <<<<[<<<<] <<<<<<<<<<<<<<<<
                # adr のコピーに x を加算
                [-<<<<< <+<+[>-]>[-<<+>>>] >>>>>]
                # adr＋x だけ主記憶にフラグを配置
                <<<<<<<
                [->>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<]
                <[->
                  >>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<
                  -[->>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<]
                  <
                ]
                # IR の元の位置へ移動
                >>>>>>>>>>>>>>>>>

                +>-[+<-  # 0001 0000
                  # LD r，adr，x

                  # adr＋x の指す位置へ移動
                  >>>>>>>> >>>>[>>>>] >
                  # adr＋x の指す値を演算用領域にコピー
                  [-
                    >>>+<<<
                    < <<<<[<<<<]
                    <<<<<<<<<<<<<<<<<<<<<<<<
                    <[<]+>[->]
                    >>>>>>>>>>>>>>>>>>>>>>>>
                    >>>>[>>>>] >
                  ]
                  >>>[-<<<+>>>]<<
                  [-
                    >>+<<
                    << <<<<[<<<<]
                    <<<<<<<<<<<<<<<<
                    <[<]+>[->]
                    >>>>>>>>>>>>>>>>
                    >>>>[>>>>] >>
                  ]
                  >>[-<<+>>]
                  # IR へ移動
                  <<<< <<<<[-<<<<] <<<<<<
                  # GR に r までのフラグを配置
                  [-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # FR をリセット
                  <<<[-]+<[-]<[-]<
                  # r へ移動
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>[-]<[[-]+<]
                  # 演算用領域へ移動
                  >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>>>
                  # 最上位ビットが立っていたら SF をセット
                  [-<+<<<+>>>>]<[->+<]>+
                  # 演算用領域の値を r に移動
                  [>]<
                  [-
                    [->+
                      <<[<] <<[-]<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                      +[>]+<[-]<[<]>[-]
                      >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]
                    ]
                    >-[+
                      <<[<] <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                      +[>] <[-]<[<]>[-]
                      >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]>
                    ]
                    <<
                  ]
                  # GR へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # GR のフラグをリセット
                  >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                <[-  # 0001 0001
                  # ST r，adr，x

                  # adr＋x の指す位置へ移動
                  >>>>>>>> >>>>[>>>>]
                  # adr＋x の指す値をリセット
                  >[-]>[-]
                  # IR へ移動
                  << <<<<[<<<<] <<<<<<
                  # GR に r までのフラグを配置
                  [-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域にフラグをセット
                  <<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r の値をを演算用領域にコピー
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>]+<-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+<+
                      [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>] <-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +<[->-<]<
                  ]
                  >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                  # GR のフラグをクリア
                  >[->>>>>>>>>>>>>>>>>>]
                  # 演算用領域の値を adr＋x の指す位置に移動
                  >>>>>>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [->>>>++++++++++++++++<<<<]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [-
                    >>>>>>>>>>>>>>>>>>>>>>>>>
                    >>>>[>>>>] >+< <<<<[<<<<]
                    <<<<<<<<<<<<<<<<<<<<<<<<<
                  ]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [->>>>++++++++++++++++<<<<]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [-
                    >>>>>>>>>>>>>>>>>
                    >>>>[>>>>] >>+<< <<<<[<<<<]
                    <<<<<<<<<<<<<<<<<
                  ]
                  # 主記憶のフラグをクリア
                  >>>>>>>>>>>>>>>>>
                  >>>>[>>>>]<<<<[-<<<<]
                  # IR の元の位置へ移動
                  <<<<<<<<
                ]
              ]
              <[-  # 0001 001*
                >>-[+  # 0001 0010
                  # LAD r，adr，x

                  # PR に 1 だけ加算
                  >>>>>> +<+[>-]>[-<<+>>>]
                  # adr へ移動
                  >>>[>>>>]+>>>> >>
                  # adr を演算用領域にコピー
                  [-
                    >>+<<
                    << <<<<[<<<<]
                    <<<<<<<<<<<<<<<<<<<<<<<
                    <[<]+>[->]
                    >>>>>>>>>>>>>>>>>>>>>>>
                    >>>>[>>>>] >>
                  ]
                  >>[-<<+>>]<
                  [-
                    >+<
                    <<< <<<<[<<<<]
                    <<<<<<<<<<<<<<<
                    <[<]+>[->]
                    >>>>>>>>>>>>>>>
                    >>>>[>>>>] >>>
                  ]
                  >[-<+>]
                  # IR へ移動
                  <<<< <<<<[<<<<] <<<<
                  # x の指定があれば、 x の値を演算用領域にコピー
                  [
                    # GR に x までのフラグを配置
                    [-
                      <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                    ]
                    # 演算用領域にフラグを配置
                    <<<<<<<<<<<
                    <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+ >>>>>>>>>>>>>>> [[->+<]<] >>-[-<+>]
                    # x へ移動
                    <<<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    # x の値を演算用領域の値に加算
                    >>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+ <<<<<<<<<<<<<<<
                    [-
                      <<+>>
                      >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>> [<]+>[->]< <<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                    ]
                    >[-
                      [-<+
                        [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>>>>>>>>>>>>>>>>>>>>
                        [<] >-[-<+>]< [<]+>[->] >[>]<
                        <<<<<<<<<<<<<<<<<<<<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      <-[+>+
                        <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>>>>>>>>>>>>>>>>>>>>
                        [<] >-[-<+>] >[>]<
                        <<<<<<<<<<<<<<<<<<<<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      ++>[-<->]>
                    ]
                    # x の値を復元
                    <<[-[->+<]<] <[->>+<<]>
                    # GR のフラグをリセット
                    >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                    # オーバーフローしたビットをリセット
                    >>>>>[-]
                    # IR の元の位置へ移動
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # GR に r までのフラグを配置
                  <[-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r へ移動
                  <<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>[-]<[[-]+<]
                  # 演算用領域へ移動
                  >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>>>
                  # 演算用領域の値を r に移動
                  [>]<
                  [-
                    [->+
                      <<[<] <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                      +[>]+<[-]<[<]>[-]
                      >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]
                    ]
                    >-[+
                      <<[<] <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                      +[>] <[-]<[<]>[-]
                      >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]>
                    ]
                    <<
                  ]
                  # GR へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # GR のフラグをリセット
                  >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]<<
              ]
            ]
            <[-  # 0001 01**
              >>-[+  # 0001 010*
                >-[+  # 0001 0100
                  # LD r1，r2

                  # GR に r2 までのフラグを配置
                  >>[-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域にフラグをセット
                  <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r2 へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r2 の値を演算用領域にコピー
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>]+<-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+<+
                      [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>] <-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +<[->-<]<
                  ]
                  >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                  # GR のフラグをリセット
                  >[->>>>>>>>>>>>>>>>>>]
                  # IR へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  # GR に r1 までのフラグを配置
                  [-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # FR をリセット
                  <<<[-]+<[-]<[-]<
                  # r へ移動
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>[-]<[[-]+<]
                  # 演算用領域へ移動
                  >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>>>
                  # 最上位ビットが立っていたら SF をセット
                  [-<+<<<+>>>>]<[->+<]>+
                  # 演算用領域の値を r に移動
                  [>]<
                  [-
                    [->+
                      <<[<] <<[-]<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                      +[>]+<[-]<[<]>[-]
                      >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]
                    ]
                    >-[+
                      <<[<] <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                      +[>] <[-]<[<]>[-]
                      >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]>
                    ]
                    <<
                  ]
                  # GR へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # GR のフラグをリセット
                  >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]<
              ]<<
            ]
          ]<
        ]<
      ]
      <[-  # 001* ****
        >+>-[+<-  # 0010 ****
          >>-[+  # 0010 0***
            +>-[+<-  # 0010 00**
              # x の指定があれば、 x の値を演算用領域にコピー
              >>>>>[
                # GR に x までのフラグを配置
                [-
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                # 演算用領域にフラグをセット
                <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                # x へ移動
                <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                # x の値を演算用領域にコピー
                >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                [-
                  [->+
                    <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>> >[>]+<-<[<] <<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                  ]
                  >-[+<+
                    [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>> >[>] <-<[<] <<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                  ]
                  +<[->-<]<
                ]
                >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                # GR のフラグをリセット
                >[->>>>>>>>>>>>>>>>>>]
                # 演算用領域の値を圧縮
                >>>>>>
                [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                [->>>>++++++++++++++++<<<<]>
                [->>>++++++++<<<]> [->>++++<<]> [->++<]>>
                [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                [->>>>++++++++++++++++<<<<]>
                [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                # IR の元の位置へ移動
                >>>>>>>>>>>>
              ]
              # PR に 1 だけ加算
              >>>> +<+[>-]>[-<<+>>>]
              # adr へ移動
              >>>[>>>>]+>>>> >>
              # adr を演算用領域にコピー
              [-
                >>+<<
                << <<<<[<<<<]
                <<<<<<<<<<<<<<<<<<<<<<<<+
                >>>>>>>>>>>>>>>>>>>>>>>>
                >>>>[>>>>] >>
              ]
              >>[-<<+>>]<
              [-
                >+<
                <<< <<<<[<<<<]
                <<<<<<<<<<<<<<<<<<<<<<<+
                >>>>>>>>>>>>>>>>>>>>>>>
                >>>>[>>>>] >>>
              ]
              >[-<+>]
              # 演算用領域へ移動
              <<<< <<<<[<<<<] <<<<<<<<<<<<<<<<
              # adr のコピーに x を加算
              [-<<<<< <+<+[>-]>[-<<+>>>] >>>>>]
              # adr＋x だけ主記憶にフラグを配置
              <<<<<<<
              [->>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<]
              <[->
                >>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<
                -[->>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<]
                <
              ]
              # adr＋x の指す位置へ移動
              >>>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>] >
              # adr＋x の指す値を演算用領域にコピー
              [-
                >>>+<<<
                < <<<<[<<<<]
                <<<<<<<<<<<<<<<<<<<<<<<
                <[<]+>[->]
                >>>>>>>>>>>>>>>>>>>>>>>
                >>>>[>>>>] >
              ]
              >>>[-<<<+>>>]<<
              [-
                >>+<<
                << <<<<[<<<<]
                <<<<<<<<<<<<<<<
                <[<]+>[->]
                >>>>>>>>>>>>>>>
                >>>>[>>>>] >>
              ]
              >>[-<<+>>]
              # IR へ移動
              <<<< <<<<[-<<<<] <<<<<<
              # GR に r までのフラグを配置
              [-
                <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
              ]
              # IR の元の位置へ移動
              <<<

              +>-[+<-  # 0010 000*
                >+>-[+<-  # 0010 0000
                  # ADDA r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算（オーバーフロー計算）
                  [-<+<<+>>>]
                  # r へ移動
                  <<<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算（オーバーフロー計算）
                  >[-
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>+>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に加算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<+>] <[<]+>[->]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<+>]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +>>
                  ]
                  # FR をリセット
                  >[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 和の最上位ビットが 1 ならば、 SF をセット
                  >>[-]>[-<+<++ <<+>> >>]<[->+<]
                  # オーバーフローしていれば、 OF をセット
                  # (((被加数の最上位ビット) and (加数の最上位ビット)) xor (和の最上位ビット)) が 1 ならばオーバーフロー
                  +<--[++[-]>-<]>[-<<<<+>>>>]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>>>
                ]
                <[-  # 0010 0001
                  # SUBA r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算（オーバーフロー計算）
                  [-<+<-<->>>]<<+<+
                  # r へ移動
                  <<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算（オーバーフロー計算）
                  >[-
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>+>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に減算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      +>-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +>>
                  ]
                  # FR をリセット
                  >[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 差の最上位ビットが 1 ならば、 SF をセット
                  >>[-]>[-<+<++ <<+>> >>]<[->+<]
                  # オーバーフローしていれば、 OF をセット
                  # (((被減数の最上位ビット) and not (減数の最上位ビット)) xor (差の最上位ビット)) が 1 ならばオーバーフロー
                  +<--[++[-]>-<]>[-<<<<+>>>>]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>>
                ]
              ]
              <[-  # 0010 001*
                >+>-[+<-  # 0010 0010
                  # ADDL r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算
                  <[-]>[-<+>]
                  # r へ移動
                  <<<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算
                  >[-
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に加算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<+>] <[<]+>[->]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<+>]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +>>
                  ]
                  # FR をリセット
                  >[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # オーバーフロービットが 1 ならば、 OF をセット
                  >>[-<<<<+>>>>]
                  # 和の最上位ビットが 1 ならば、 SF をセット
                  >[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>>>
                ]
                <[-  # 0010 0011
                  # SUBL r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算
                  [-<+<->>]<<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算
                  >[-
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に減算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      +>-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +>>
                  ]
                  # FR をリセット
                  >[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # オーバーフロービットが 0 ならば、 OF をセット
                  >>-[+<<<<+>>>>]
                  # 差の最上位ビットが 1 ならば、 SF をセット
                  >[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>>
                ]<
              ]
            ]
            <[-  # 0010 01**
              # GR に r2 までのフラグを配置
              >>>>>[-
                <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
              ]
              # 演算用領域にフラグをセット
              <<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
              # r2 へ移動
              <<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
              # r2 の値を演算用領域にコピー
              >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
              [-
                [->+
                  <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                  >>>>> >[>]+<-<[<] <<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                ]
                >-[+<+
                  [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                  >>>>> >[>] <-<[<] <<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                ]
                +<[->-<]<
              ]
              >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
              # GR のフラグをリセット
              >[->>>>>>>>>>>>>>>>>>]
              # IR へ移動
              >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
              # GR に r1 までのフラグを配置
              [-
                <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
              ]
              # IR の元の位置へ移動
              <<<

              +>-[+<-  # 0010 010*
                >+>-[+<-  # 0010 0100
                  # ADDA r1，r2

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算（オーバーフロー計算）
                  [-<+<<+>>>]
                  # r へ移動
                  <<<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算（オーバーフロー計算）
                  >[-
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>+>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に加算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<+>] <[<]+>[->]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<+>]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +>>
                  ]
                  # FR をリセット
                  >[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 和の最上位ビットが 1 ならば、 SF をセット
                  >>[-]>[-<+<++ <<+>> >>]<[->+<]
                  # オーバーフローしていれば、 OF をセット
                  # (((被加数の最上位ビット) and (加数の最上位ビット)) xor (和の最上位ビット)) が 1 ならばオーバーフロー
                  +<--[++[-]>-<]>[-<<<<+>>>>]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>>>
                ]
                <[-  # 0010 0101
                  # SUBA r1，r2

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算（オーバーフロー計算）
                  [-<+<-<->>>]<<+<+
                  # r へ移動
                  <<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算（オーバーフロー計算）
                  >[-
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>+>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に減算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      +>-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +>>
                  ]
                  # FR をリセット
                  >[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 差の最上位ビットが 1 ならば、 SF をセット
                  >>[-]>[-<+<++ <<+>> >>]<[->+<]
                  # オーバーフローしていれば、 OF をセット
                  # (((被減数の最上位ビット) and not (減数の最上位ビット)) xor (差の最上位ビット)) が 1 ならばオーバーフロー
                  +<--[++[-]>-<]>[-<<<<+>>>>]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>>
                ]
              ]
              <[-  # 0010 011*
                >+>-[+<-  # 0010 0110
                  # ADDL r1，r2

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算
                  <[-]>[-<+>]
                  # r へ移動
                  <<<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算
                  >[-
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に加算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<+>] <[<]+>[->]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<+>]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +>>
                  ]
                  # FR をリセット
                  >[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # オーバーフロービットが 1 ならば、 OF をセット
                  >>[-<<<<+>>>>]
                  # 和の最上位ビットが 1 ならば、 SF をセット
                  >[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>>>
                ]
                <[-  # 0010 0111
                  # SUBL r1，r2

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算
                  [-<+<->>]<<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算
                  >[-
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に減算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      +>-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +>>
                  ]
                  # FR をリセット
                  >[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # オーバーフロービットが 0 ならば、 OF をセット
                  >>-[+<<<<+>>>>]
                  # 差の最上位ビットが 1 ならば、 SF をセット
                  >[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>>
                ]<
              ]<
            ]

            # 演算用領域の値を r に移動
            # 移動中に ZF をリセット
            <<<<<<<<[-
              [->+
                <<[<] <<[-]<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                +[>]+<[-]<[<]>[-]
                >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]
              ]
              >-[+
                <<[<] <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                +[>] <[-]<[<]>[-]
                >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]>
              ]
              <<
            ]
            # GR へ移動
            <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
            # GR のフラグをリセット
            >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
            # IR の元の位置へ移動
            >>>>>>>>>>>>>>>>>>>>>>>>>>>>
          ]<
        ]
        <[-  # 0011 ****
          >>-[+  # 0011 0***
            +>-[+<-  # 0011 00**
              >>[->++<]>---[+++  # 0011 0000 ～ 0011 0010
                # x の指定があれば、 x の値を演算用領域にコピー
                >>[
                  # GR に x までのフラグを配置
                  [-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域にフラグをセット
                  <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # x へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # x の値を演算用領域にコピー
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>]+<-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+<+
                      [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>] <-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +<[->-<]<
                  ]
                  >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                  # GR のフラグをリセット
                  >[->>>>>>>>>>>>>>>>>>]
                  # 演算用領域の値を圧縮
                  >>>>>>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [->>>>++++++++++++++++<<<<]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [->>>>++++++++++++++++<<<<]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>
                ]
                # PR に 1 だけ加算
                >>>> +<+[>-]>[-<<+>>>]
                # adr へ移動
                >>>[>>>>]+>>>> >>
                # adr を演算用領域にコピー
                [-
                  >>+<<
                  << <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<<<<<<<<+
                  >>>>>>>>>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >>
                ]
                >>[-<<+>>]<
                [-
                  >+<
                  <<< <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<<<<<<<+
                  >>>>>>>>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >>>
                ]
                >[-<+>]
                # 演算用領域へ移動
                <<<< <<<<[<<<<] <<<<<<<<<<<<<<<<
                # adr のコピーに x を加算
                [-<<<<< <+<+[>-]>[-<<+>>>] >>>>>]
                # adr＋x だけ主記憶にフラグを配置
                <<<<<<<
                [->>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<]
                <[->
                  >>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<
                  -[->>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<]
                  <
                ]
                # adr＋x の指す位置へ移動
                >>>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>] >
                # adr＋x の指す値を演算用領域にコピー
                [-
                  >>>+<<<
                  < <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<<<<<<<<<
                  <[<]+>[->]
                  >>>>>>>>>>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >
                ]
                >>>[-<<<+>>>]<<
                [-
                  >>+<<
                  << <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<
                  <[<]+>[->]
                  >>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >>
                ]
                >>[-<<+>>]
                # IR へ移動
                <<<< <<<<[-<<<<] <<<<<<
                # GR に r までのフラグを配置
                [-
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                # IR の元の位置へ移動
                <<

                +>[<-]<[<]>[->+++  # 0011 0000
                  # AND r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値と演算用領域の値に AND 演算
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <-[->+<] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <[-] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]>
                    ]
                    <<
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>
                  # FR をリセット
                  >>[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 演算結果の最上位ビットが 1 ならば、 SF をセット
                  >>>[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>
                ]
                +>-[<-]<[<]>[->++  # 0011 0001
                  # OR r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値と演算用領域の値に OR 演算
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] +<[-] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <-[->+<] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]>
                    ]
                    <<
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>
                  # FR をリセット
                  >>[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 演算結果の最上位ビットが 1 ならば、 SF をセット
                  >>>[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>
                ]
                +>-[<-]<[<]>[->+  # 0011 0010
                  # XOR r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値と演算用領域の値に OR 演算
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <--[+>+<] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <-[->+<] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]>
                    ]
                    <<
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>
                  # FR をリセット
                  >>[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 演算結果の最上位ビットが 1 ならば、 SF をセット
                  >>>[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>
                ]

                # 演算用領域の値を r に移動
                # 移動中に ZF をリセット
                <<<<<<<<<[-
                  [->+
                    <<[<] <<[-]<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    +[>]+<[-]<[<]>[-]
                    >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]
                  ]
                  >-[+
                    <<[<] <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    +[>] <[-]<[<]>[-]
                    >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]>
                  ]
                  <<
                ]
                # GR へ移動
                <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                # GR のフラグをリセット
                >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                # IR の元の位置へ移動
                >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>-
              ]<<
            ]
            <[-  # 0011 01**
              >>[->++<]>---[+++  # 0011 0100 ～ 0011 0110
                # GR に r2 までのフラグを配置
                >>[-
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                # 演算用領域にフラグをセット
                <<<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                # ZF をリセット
                <[-]
                # r2 へ移動
                <<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                # r2 の値を演算用領域にコピー
                >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                [-
                  [->+
                    <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>> >[>]+<-<[<] <<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                  ]
                  >-[+<+
                    [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>> >[>] <-<[<] <<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                  ]
                  +<[->-<]<
                ]
                >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                # GR のフラグをリセット
                >[->>>>>>>>>>>>>>>>>>]
                # IR へ移動
                >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                # GR に r1 までのフラグを配置
                [-
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                # IR の元の位置へ移動
                <<

                +>[<-]<[<]>[->+++  # 0011 0100
                  # AND r1，r2

                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値と演算用領域の値に AND 演算
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <-[->+<] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <[-] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]>
                    ]
                    <<
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>
                  # FR をリセット
                  >>[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 演算結果の最上位ビットが 1 ならば、 SF をセット
                  >>>[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>
                ]
                +>-[<-]<[<]>[->++  # 0011 0101
                  # OR r1，r2

                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値と演算用領域の値に OR 演算
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] +<[-] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <-[->+<] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]>
                    ]
                    <<
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>
                  # FR をリセット
                  >>[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 演算結果の最上位ビットが 1 ならば、 SF をセット
                  >>>[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>
                ]
                +>-[<-]<[<]>[->+  # 0011 0110
                  # XOR r1，r2

                  # 演算用領域にフラグをセット
                  <<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値と演算用領域の値に OR 演算
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <--[+>+<] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>[>] <-[->+<] <[<]<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]>
                    ]
                    <<
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>
                  # FR をリセット
                  >>[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
                  # 演算結果の最上位ビットが 1 ならば、 SF をセット
                  >>>[-<+< <<+>> >>]<[->+<]
                  # 演算用領域にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # IR の元の位置へ移動
                  >>>>>>>>>
                ]

                # 演算用領域の値を r に移動
                # 移動中に ZF をリセット
                <<<<<<<<<[-
                  [->+
                    <<[<] <<[-]<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    +[>]+<[-]<[<]>[-]
                    >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]
                  ]
                  >-[+
                    <<[<] <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    +[>] <[-]<[<]>[-]
                    >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]>
                  ]
                  <<
                ]
                # GR へ移動
                <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                # GR のフラグをリセット
                >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                # IR の元の位置へ移動
                >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>-
              ]<<<
            ]
          ]<<
        ]<
      ]
    ]
    <[-  # 01** ****
      >+>-[+<-  # 010* ****
        >+>-[+<-  # 0100 ****
          >>-[+  # 0100 0***
            +>-[+<-  # 0100 00**
              >>-[+  # 0100 000*
                # x の指定があれば、 x の値を演算用領域にコピー
                >>>[
                  # GR に x までのフラグを配置
                  [-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域にフラグをセット
                  <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # x へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # x の値を演算用領域にコピー
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-
                    [->+
                      <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>]+<-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    >-[+<+
                      [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>> >[>] <-<[<] <<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    +<[->-<]<
                  ]
                  >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                  # GR のフラグをリセット
                  >[->>>>>>>>>>>>>>>>>>]
                  # 演算用領域の値を圧縮
                  >>>>>>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [->>>>++++++++++++++++<<<<]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  [->>>>++++++++++++++++<<<<]>
                  [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>
                ]
                # PR に 1 だけ加算
                >>>> +<+[>-]>[-<<+>>>]
                # adr へ移動
                >>>[>>>>]+>>>> >>
                # adr を演算用領域にコピー
                [-
                  >>+<<
                  << <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<<<<<<<<+
                  >>>>>>>>>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >>
                ]
                >>[-<<+>>]<
                [-
                  >+<
                  <<< <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<<<<<<<+
                  >>>>>>>>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >>>
                ]
                >[-<+>]
                # 演算用領域へ移動
                <<<< <<<<[<<<<] <<<<<<<<<<<<<<<<
                # adr のコピーに x を加算
                [-<<<<< <+<+[>-]>[-<<+>>>] >>>>>]
                # adr＋x だけ主記憶にフラグを配置
                <<<<<<<
                [->>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<]
                <[->
                  >>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<
                  -[->>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>]+<<<<[<<<<] <<<<<<<<<<<<<<<<<<<<<<<<]
                  <
                ]
                # adr＋x の指す位置へ移動
                >>>>>>>>>>>>>>>>>>>>>>>>> >>>>[>>>>] >
                # adr＋x の指す値を演算用領域にコピー
                [-
                  >>>+<<<
                  < <<<<[<<<<]
                  <<<<<<<<<<<<<<<<<<<<<<<
                  <[<]+>[->]
                  >>>>>>>>>>>>>>>>>>>>>>>
                  >>>>[>>>>] >
                ]
                >>>[-<<<+>>>]<<
                [-
                  >>+<<
                  << <<<<[<<<<]
                  <<<<<<<<<<<<<<<
                  <[<]+>[->]
                  >>>>>>>>>>>>>>>
                  >>>>[>>>>] >>
                ]
                >>[-<<+>>]
                # IR へ移動
                <<<< <<<<[-<<<<] <<<<<<
                # GR に r までのフラグを配置
                [-
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                # IR の元の位置へ移動
                <<

                +>-[+<-  # 0100 0000
                  # CPA r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算
                  [-<-<+>>]<+
                  # r へ移動
                  <<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算
                  >-[+<<+>>
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に減算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      +>-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+>+
                      >[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    ++>[-<->]>
                  ]
                  <<[-[->+<]<] <-[+>>+<<]>
                  # GR のフラグをリセット
                  >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                  # FR をリセット
                  >[-]>[-]>[-]+
                  # オーバーフロービットが 0 ならば、 SF をセット
                  >>-[+<<<+>>>]
                  # 演算用領域の値をリセットしながら ZF をリセット
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-[-<[<]<<[-]>>>[>]]<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                <[-  # 0100 0001
                  # CPL r，adr，x

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算
                  [-<+<->>]<<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算
                  >[-<<+>>
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に減算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      +>-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+>+
                      >[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    ++>[-<->]>
                  ]
                  <<[-[->+<]<] <[->>+<<]>
                  # GR のフラグをリセット
                  >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                  # FR をリセット
                  >[-]>[-]>[-]+
                  # オーバーフロービットが 0 ならば、 SF をセット
                  >>-[+<<<+>>>]
                  # 演算用領域の値をリセットしながら ZF をリセット
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-[-<[<]<<[-]>>>[>]]<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>
                ]
              ]<
            ]
            <[-  # 0100 01**
              >>-[+  # 0100 010*
                # GR に r2 までのフラグを配置
                >>>[-
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                # 演算用領域にフラグをセット
                <<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                # r2 へ移動
                <<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                # r2 の値を演算用領域にコピー
                >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                [-
                  [->+
                    <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>> >[>]+<-<[<] <<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                  ]
                  >-[+<+
                    [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>> >[>] <-<[<] <<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                  ]
                  +<[->-<]<
                ]
                >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                # GR のフラグをリセット
                >[->>>>>>>>>>>>>>>>>>]
                # IR へ移動
                >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                # GR に r1 までのフラグを配置
                [-
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                # IR の元の位置へ移動
                <<

                +>-[+<-  # 0100 0100
                  # CPA r1，r2
                  
                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算
                  [-<-<+>>]<+
                  # r へ移動
                  <<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算
                  >-[+<<+>>
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に減算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      +>-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+>+
                      >[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    ++>[-<->]>
                  ]
                  <<[-[->+<]<] <-[+>>+<<]>
                  # GR のフラグをリセット
                  >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                  # FR をリセット
                  >[-]>[-]>[-]+
                  # オーバーフロービットが 0 ならば、 SF をセット
                  >>-[+<<<+>>>]
                  # 演算用領域の値をリセットしながら ZF をリセット
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-[-<[<]<<[-]>>>[>]]<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                <[-  # 0100 0101
                  # CPL r1，r2

                  # 演算用領域にフラグをセット
                  <<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビット計算
                  [-<+<->>]<<+
                  # r へ移動
                  <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  # 最上位ビット計算
                  >[-<<+>>
                    >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>>>> [<]+>[->]< <<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                  ]
                  # r にフラグを配置
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  # r の値を演算用領域の値に減算
                  [<]>[-
                    [-<+
                      >>[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      +>-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    <-[+>+
                      >[>]> [>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>> [<]
                      >-[-<-[++<-]>[>]]
                      >[>]< <<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                    ]
                    ++>[-<->]>
                  ]
                  <<[-[->+<]<] <[->>+<<]>
                  # GR のフラグをリセット
                  >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                  # FR をリセット
                  >[-]>[-]>[-]+
                  # オーバーフロービットが 0 ならば、 SF をセット
                  >>-[+<<<+>>>]
                  # 演算用領域の値をリセットしながら ZF をリセット
                  >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                  [-[-<[<]<<[-]>>>[>]]<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>
                ]
              ]<<
            ]
          ]<
        ]
        <[-  # 0101 ****
          >>-[+  # 0101 0***
            >-[+  # 0101 00**
              # x の指定があれば、 x の値を演算用領域にコピー
              >>>>[
                # GR に x までのフラグを配置
                [-
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                # 演算用領域にフラグをセット
                <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                # x へ移動
                <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                # x の値を演算用領域にコピー
                >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                [-
                  [->+
                    <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>> >[>]+<-<[<] <<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                  ]
                  >-[+<+
                    [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                    >>>> >[>] <-<[<] <<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                  ]
                  +<[->-<]<
                ]
                >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                # GR のフラグをリセット
                >[->>>>>>>>>>>>>>>>>>]
                # 演算用領域の値を圧縮
                >>>>>>
                [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                [->>>>++++++++++++++++<<<<]>
                [->>>++++++++<<<]> [->>++++<<]> [->++<]>>
                [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                [->>>>++++++++++++++++<<<<]>
                [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                # IR の元の位置へ移動
                >>>>>>>>>>>>
              ]
              # PR に 1 だけ加算
              >>>> +<+[>-]>[-<<+>>>]
              # adr へ移動
              >>>[>>>>]+>>>> >>
              # adr を演算用領域にコピー
              [-
                >>+<<
                << <<<<[<<<<]
                <<<<<<<<<<<<<<<<<<<<<<<<+
                >>>>>>>>>>>>>>>>>>>>>>>>
                >>>>[>>>>] >>
              ]
              >>[-<<+>>]<
              [-
                >+<
                <<< <<<<[<<<<]
                <<<<<<<<<<<<<<<<<<<<<<<+
                >>>>>>>>>>>>>>>>>>>>>>>
                >>>>[>>>>] >>>
              ]
              >[-<+>]
              # 演算用領域へ移動
              <<<< <<<<[<<<<] <<<<<<<<<<<<<<<<
              # adr のコピーに x を加算
              [-<<<<< <+<+[>-]>[-<<+>>>] >>>>>]
              # min(adr＋x，17)
              <<<<<<+<<[[-]>[-]>->>>>>>>>+++++++++++++++++<<<<<<<<<<]
              >>[++++++++++++++++[-<<+>[->>>>>>>>>+<<<<<<<<<<-]<[<]>[->>[-]<<]>>]<[-]>]
              # GR に r までのフラグを配置
              >>>>>>>>>>>>>>>>>[-
                <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
              ]
              # 演算用領域にフラグをセット
              <<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
              # r へ移動
              <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
              # r にフラグを配置
              >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
              # r の値と演算用領域の値に AND 演算
              [-
                [->+
                  <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                  >>>> >[>]+<-<[<] <<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                ]
                >-[+
                  <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                  >>>> >[>] <-<[<] <<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]>
                ]
                <<
              ]
              # r にフラグを配置
              >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>
              # FR をリセット
              >>[>>>>>>>>>>>>>>>>>>] >[-]>[-]>[-]+
              # IR の元の位置へ移動
              >>>>>>>>>>>>>>>>>>>>>>>>>>

              +>-[+<-  # 0101 000*
                >+>-[+<-  # 0101 0000
                  # SLA r，adr，x

                  # 演算用領域にフラグを配置
                  <<<<<<<<< +<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビットを退避
                  [-<<+>>]
                  # 演算用領域の値をシフト
                  >[>]>[-
                    # OF をリセット
                    <<[<]<<<<<[-]
                    # 第 14 ビットを OF に移動
                    >>>>>>-[-<<<<<<+>>>>>>]
                    # 左シフト
                    >[[-<+>]>]<+>>
                  ]
                  # 最上位ビットを復元
                  # 最上位ビットが 1 ならば、 SF をセット
                  <<<<<<<<<<<<<<<<< +<<[-<<+>>>>+<<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                <[-  # 0101 0001
                  # SRA r，adr，x

                  # 演算用領域にフラグを配置
                  <<<<<<<<< +<+<+<+<+<+<+<+<+<+<+<+<+<+<+<
                  # 最上位ビットを退避
                  [-<+>]
                  # 演算用領域の値をシフト
                  >[>]>[-
                    # OF をリセット
                    <<[<]<<<<<[-]
                    # 第 0 ビットを OF に移動
                    >>>>>>[>]<-[-<[<]<<<<<+>>>>>>[>]]
                    # 右シフト
                    <[[->+<]<]<[->+>+<<]>[-<+>]>+[>]>
                  ]
                  # 最上位ビットを復元
                  # 最上位ビットが 1 ならば、 SF をセット
                  <<<<<<<<<<<<<<<<< +<[-<<<+>>>>+<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>
                ]
              ]
              <[-  # 0101 001*
                >+>-[+<-  # 0101 0010
                  # SLL r，adr，x

                  # 演算用領域にフラグを配置
                  <<<<<<<<< +<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # 演算用領域の値をシフト
                  [>]>[-
                    # OF をリセット
                    <<[<]<<<<[-]
                    # 第 15 ビットを OF に移動
                    >>>>>-[-<<<<<+>>>>>]
                    # 左シフト
                    >[[-<+>]>]<+>>
                  ]
                  # 最上位ビットが 1 ならば、 SF をセット
                  <<<<<<<<<<<<<<<<< -[-<+<<<+>>>>]+<[->+<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                <[-  # 0101 0011
                  # SRL r，adr，x

                  # 演算用領域にフラグを配置
                  <<<<<<<<< +<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                  # 演算用領域の値をシフト
                  [>]>[-
                    # OF をリセット
                    <<[<]<<<<[-]
                    # 第 0 ビットを OF に移動
                    >>>>>[>]<-[-<[<]<<<<+>>>>>[>]]
                    # 右シフト
                    <[[->+<]<]>+[>]>
                  ]
                  # 最上位ビットが 1 ならば、 SF をセット
                  <<<<<<<<<<<<<<<<< -[-<+<<<+>>>>]+<[->+<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>
                ]<
              ]

              # 演算用領域の値を r に移動
              # 移動中に ZF をリセット
              <<<<<<<<[-
                [->+
                  <<[<] <<[-]<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  +[>]+<[-]<[<]>[-]
                  >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]
                ]
                >-[+
                  <<[<] <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  +[>] <[-]<[<]>[-]
                  >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>] >>>>> >[>]>
                ]
                <<
              ]
              # GR へ移動
              <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
              # GR のフラグをリセット
              >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
              # IR の元の位置へ移動
              >>>>>>>>>>>>>>>>>>>>>>>>>>>>>
            ]<
          ]<<
        ]
      ]
      <[-  # 011* ****
        >+>-[+<-  # 0110 ****
          >>-[+  # 0110 0***
            >[->>++++<<]>[->++<]>[  # 0110 0001 ～ 0110 0111
              -------[++++++  # 0110 0001 ～ 0110 0110
                <
                +>[<-]<[<]>[->++++++  # 0110 0001
                  # JMI adr，x

                  # SF が 1 ならば、フラグをセット
                  <<<<<<<<<<<<<<<<<<<<<<<<<<< <<[->>+>+<<<]>>[-<<+>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                +>-[<-]<[<]>[->+++++  # 0110 0010
                  # JNZ adr，x

                  # ZF が 0 ならば、フラグをセット
                  <<<<<<<<<<<<<<<<<<<<<<<<<<+< <[->+>-<<]>[-<+>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                +>-[<-]<[<]>[->++++  # 0110 0011
                  # JZE adr，x

                  # ZF が 1 ならば、フラグをセット
                  <<<<<<<<<<<<<<<<<<<<<<<<<<< <[->+>+<<]>[-<+>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                +>-[<-]<[<]>[->+++  # 0110 0100
                  # JUMP adr，x
                  
                  # フラグをセット
                  <<<<<<<<<<<<<<<<<<<<<<<<<<+
                  >>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                +>-[<-]<[<]>[->++  # 0110 0101
                  # JPL adr，x

                  # SF が 0 かつ ZF が 0 ならば、フラグをセット
                  <<<<<<<<<<<<<<<<<<<<<<<<<<+<
                  <<[->>+>-<<<]>>[-<<+>>]
                  <[->+>[-]<<]>[-<+>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                +>-[<-]<[<]>[->+  # 0110 0110
                  # JOV adr，x

                  # OF が 1 ならば、フラグをセット
                  <<<<<<<<<<<<<<<<<<<<<<<<<<< <<<[->>>+>+<<<<]>>>[-<<<+>>>]
                  >>>>>>>>>>>>>>>>>>>>>>>>>>
                ]

                # PR の増分を 1 に設定
                <<<<<<<<+
                # フラグが立っていたら adr を PR にコピー
                <<<<<<<<<<<<<<<<<[-
                  # PR の増分を －1 に設定
                  >>>>>>>>>>>>>>>>>--
                  # PR をリセット
                  >>>>>>>>>>>>>[-]>[-]>
                  # adr へ移動
                  >>>>[>>>>]+>>>> >>
                  # adr を PR にコピー
                  [->>+<< << <<<<[<<<<] <<+>> >>>>[>>>>] >>] >>[-<<+>>]<
                  [->+< <<< <<<<[<<<<] <+> >>>>[>>>>] >>>] >[-<+>]
                  # 主記憶のフラグをリセット
                  <<<< <<<<[-<<<<]
                  # IR へ移動
                  <<<<
                  # x の指定があれば、その分 PR に加算
                  [
                    # GR に x までのフラグを配置
                    [-
                      <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                    ]
                    # 演算用領域にフラグをセット
                    <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                    # x へ移動
                    <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    # x の値を演算用領域にコピー
                    >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                    [-
                      [->+
                        <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>> >[>]+<-<[<] <<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      >-[+<+
                        [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>> >[>] <-<[<] <<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      +<[->-<]<
                    ]
                    >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                    # GR のフラグをリセット
                    >[->>>>>>>>>>>>>>>>>>]
                    # 演算用領域へ移動
                    >>>>>>
                    # 演算用領域の値を PR に加算
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>++++++++++++++++<<<<]>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>>>>>>>>>>>>>>>>>>>+<<<<<<<<<<<<<<<<<<<<<<]>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>++++++++++++++++<<<<]>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>>>>>>>>>>>>> +<+[>-]>[-<<+>>>]< <<<<<<<<<<<<<<<<]
                    # IR の元の位置へ移動
                    >>>>>>>>>>>>
                  ]
                  # PR の値を MAR にコピー
                  >>[->>+ >>+<< <<] >>[-<<+>>]
                  <[->+ >>>+<<< <] >[-<+>]
                  # MAR の値だけ主記憶にフラグを配置
                  >>>[->[>>>>]+[<<<<]>>>]
                  <[->>[>>>>]+[<<<<]>> >-[->[>>>>]+[<<<<]>>>]<]
                  # 演算用領域の元の位置へ移動
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                ]
                # IR の元の位置へ移動
                >>>>>>>>>>>>>>>>>>>>>>>>>>-
              ]
            ]<<<
          ]<
        ]
        <[-  # 0111 ****
          >>-[+  # 0111 0***
            >-[+  # 0111 00**
              >-[+  # 0111 000*
                +>-[+<-  # 0111 0000
                  # PUSH adr，x

                  >>>[
                    # GR に x までのフラグを配置
                    [-
                      <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                    ]
                    # 演算用領域にフラグをセット
                    <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                    # x へ移動
                    <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    # x の値を演算用領域にコピー
                    >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                    [-
                      [->+
                        <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>> >[>]+<-<[<] <<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      >-[+<+
                        [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>> >[>] <-<[<] <<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      +<[->-<]<
                    ]
                    >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                    # GR のフラグをリセット
                    >[->>>>>>>>>>>>>>>>>>]
                    # 演算用領域へ移動
                    >>>>>>
                    # 演算用領域の値を PR に加算
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>++++++++++++++++<<<<]>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>++++++++++++++++<<<<]>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    # IR の元の位置へ移動
                    >>>>>>>>>>>>
                  ]
                  # PR に 1 だけ加算
                  >>>> +<+[>-]>[-<<+>>>]
                  # adr へ移動
                  >>>[>>>>]+>>>> >>
                  # adr を演算用領域にコピー
                  [-
                    >>+<<
                    << <<<<[<<<<]
                    <<<<<<<<<<<<<<<<<<<<<<<<+
                    >>>>>>>>>>>>>>>>>>>>>>>>
                    >>>>[>>>>] >>
                  ]
                  >>[-<<+>>]<
                  [-
                    >+<
                    <<< <<<<[<<<<]
                    <<<<<<<<<<<<<<<<<<<<<<<+
                    >>>>>>>>>>>>>>>>>>>>>>>
                    >>>>[>>>>] >>>
                  ]
                  >[-<+>]
                  # 演算用領域へ移動
                  <<<< <<<<[<<<<]
                  <<<<<<<<<<<<<<<<
                  # adr のコピーに x を加算
                  [-<<<<< <+<+[>-]>[-<<+>>>] >>>>>]
                  # 演算用領域の値をスタックに移動
                  <<<<<<<
                  [-
                    <<<<<<<<<<<<<<
                    ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    <<<<[<<<]>>+>[>>>]>
                    ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    >>>>>>>>>>>>>>
                  ]
                  <[-
                    <<<<<<<<<<<<<
                    ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    <<<<[<<<]>+>>[>>>]>
                    ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    >>>>>>>>>>>>>
                  ]
                  # スタック領域へ移動
                  <<<<<<<<<<<<<
                  ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                  # スタックのフラグを 1 つ追加
                  <<<<[<<<]+[>>>]>
                  # IR の元の位置へ移動
                  ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
                <[-  # 0111 0001
                  # POP r

                  # GR に r までのフラグを配置
                  >>[-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # r の値をリセット
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                  >[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-] >>
                  [>>>>>>>>>>>>>>>>>>]
                  # GR 逆向き探索用番兵をセット
                  +
                  ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                  +
                  # スタックのフラグを 1 つリセット
                  <<<<[<<<]>>>-
                  # スタックのトップの値を r に移動
                  >[-
                    >>[>>>]>
                    >>>>>>>>>>>>>>>>>>-[+>>>>>>>>>>>>>>>>>>-]+
                    <<<<<<<<<< [<]+>[->]< <<<<<<<<
                    -[+<<<<<<<<<<<<<<<<<<-]+
                    <<<<[<<<]>
                  ]
                  >[-
                    >[>>>]>
                    >>>>>>>>>>>>>>>>>>-[+>>>>>>>>>>>>>>>>>>-]+
                    << [<]+>[->]< <<<<<<<<<<<<<<<<
                    -[+<<<<<<<<<<<<<<<<<<-]+
                    <<<<[<<<]>>
                  ]
                  # 逆向き探索用番兵をリセット
                  >[>>>]>-
                  ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                  -
                  # GR のフラグをクリア
                  <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                ]
              ]<
            ]<
          ]<<
        ]<
      ]<
    ]
  ]
  <[-  # 1*** ****
    >+>-[+<-  # 10** ****
      >>-[+  # 100* ****
        >-[+  # 1000 ****
          >-[+  # 1000 0***
            >-[+  # 1000 00**
              >-[+  # 1000 000*
                +>-[+<-  # 1000 0000
                  # CALL adr，x

                  # PR に 2 だけ加算
                  >>>>>>> +<+[>-]>[-<<+>>>]< +<+[>-]>[-<<+>>>]<<<
                  # PR の値をスタックに移動
                  [-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    <<<<[<<<]>+>>[>>>]>
                    ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]>
                  [-
                    <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                    ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    <<<<[<<<]>>+>[>>>]>
                    ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]>
                  # adr へ移動
                  >>>>[>>>>]+>>>> >>
                  # adr を PR にコピー
                  [->>+<< << <<<<[<<<<] <<+>> >>>>[>>>>] >>] >>[-<<+>>]<
                  [->+< <<< <<<<[<<<<] <+> >>>>[>>>>] >>>] >[-<+>]
                  # 主記憶のフラグをリセット
                  <<<< <<<<[-<<<<]
                  # IR へ移動
                  <<<<
                  # x の指定があれば、その分 PR に加算
                  [
                    # GR に x までのフラグを配置
                    [-
                      <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                    ]
                    # 演算用領域にフラグをセット
                    <<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                    # x へ移動
                    <<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    # x の値を演算用領域にコピー
                    >+>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                    [-
                      [->+
                        <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>> >[>]+<-<[<] <<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      >-[+<+
                        [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>> >[>] <-<[<] <<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      +<[->-<]<
                    ]
                    >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                    # GR のフラグをリセット
                    >[->>>>>>>>>>>>>>>>>>]
                    # 演算用領域へ移動
                    >>>>>>
                    # 演算用領域の値を PR に加算
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>++++++++++++++++<<<<]>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>>>>>>>>>>>>>>>>>>>+<<<<<<<<<<<<<<<<<<<<<<]>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>++++++++++++++++<<<<]>
                    [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                    [->>>>>>>>>>>>>>>> +<+[>-]>[-<<+>>>]< <<<<<<<<<<<<<<<<]
                    # IR の元の位置へ移動
                    >>>>>>>>>>>>
                  ]
                  # PR の値を MAR にコピー
                  >>[->>+ >>+<< <<] >>[-<<+>>]
                  <[->+ >>>+<<< <] >[-<+>]
                  # MAR の値だけ主記憶にフラグを配置
                  >>>[->[>>>>]+[<<<<]>>>]
                  <[->>[>>>>]+[<<<<]>> >-[->[>>>>]+[<<<<]>>>]<]
                  # スタック領域へ移動
                  <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                  ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                  # スタックのフラグを 1 つ追加
                  <<<<[<<<]+[>>>]>
                  # 演算用領域へ移動
                  ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                  >>>>>>>>>>>>>>>>>>>>>>
                  # PR の増分を ―1 に設定
                  -
                  # IR の元の位置へ移動
                  >>>>>>>>>
                ]
                <[-  # 1000 0001
                  # RET

                  # PR の値をリセット
                  >>>>>[-]>[-]> >>>>[>>>>]<<<<[-<<<<]
                  # プログラム終了のフラグをセット
                  <<<<<<<<<<<<<<+
                  # スタック領域へ移動
                  <<<<<<<<<<<<<<<<<<<<<<<
                  ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                  # スタックのフラグを 1 つリセット
                  <<<<[<<<]>>>-
                  # スタックのトップの値を各セルに 1 足してから PR と MAR に移動
                  >+[-
                    >>[>>>]>
                    ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    >>>>>>>>>>>>>>>>>>>>>>>[-]
                    >>>>>>>>>>>>+>>>>+
                    <<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<<<<<<
                    ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    <<<<[<<<]>
                  ]
                  >+[-
                    >[>>>]>
                    ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    >>>>>>>>>>>>>>>>>>>>>>>[-]
                    >>>>>>>>>>>>>+>>>>+
                    <<<<<<<<<<<<<<<<<
                    <<<<<<<<<<<<<<<<<<<<<<<
                    ${"<<<<<<<<<<<<<<<<<< ".repeat(option.gr === "16" ? 16 : 8).trim()}
                    <<<<[<<<]>>
                  ]
                  # 演算用領域へ移動
                  >[>>>]>
                  ${">>>>>>>>>>>>>>>>>> ".repeat(option.gr === "16" ? 16 : 8).trim()}
                  >>>>>>>>>>>>>>>>>>>>>>
                  # PR の増分を ―1 に設定
                  -
                  # プログラム終了フラグが残っていたら実行フラグをリセット
                  >[->>>>>>>>>>>-<<<<<<<<<<<]
                  # PR の各セルから 1 だけ減算
                  >>>>>>>>>>>>->-
                  # 実行フラグが立っていたら MAR の値だけ主記憶にフラグを配置
                  <<[-
                    >>>>+>
                    >-[->[>>>>]+[<<<<]>>>]
                    <-[->>[>>>>]+[<<<<]>> >-[->[>>>>]+[<<<<]>>>]<]
                    <<<<<
                  ]
                  >>>>[-<<<<+>>>>]
                  # IR の元の位置へ移動
                  <<<<<<<<
                ]
              ]<
            ]<
          ]<
        ]<
      ]<
    ]
    <[-  # 11** ****
      >>[-  # 111* ****
        >[-  # 1111 ****
          >-[+  # 1111 0***
            >-[+  # 1111 00**
              >-[+  # 1111 000*
                >-[+  # 1111 0000
                  # SVC adr，x

                  # PR に 1 だけ加算
                  >>>>>> +<+[>-]>[-<<+>>>]
                  # adr へ移動
                  >>>[>>>>]+>>>> >>
                  # adr を演算用領域にコピー
                  [-
                    >>+<<
                    << <<<<[<<<<]
                    <<<<<<<<<<<<<<<<<<<<<<<
                    <[<]+>[->]
                    >>>>>>>>>>>>>>>>>>>>>>>
                    >>>>[>>>>] >>
                  ]
                  >>[-<<+>>]<
                  [-
                    >+<
                    <<< <<<<[<<<<]
                    <<<<<<<<<<<<<<<
                    <[<]+>[->]
                    >>>>>>>>>>>>>>>
                    >>>>[>>>>] >>>
                  ]
                  >[-<+>]
                  # IR へ移動
                  <<<< <<<<[<<<<] <<<<
                  # x の指定があれば、 x の値を演算用領域にコピー
                  [
                    # GR に x までのフラグを配置
                    [-
                      <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]+[>>>>>>>>>>>>>>>>>>]
                      >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
                    ]
                    # 演算用領域にフラグを配置
                    <<<<<<<<<<<
                    <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+ >>>>>>>>>>>>>>> [[->+<]<] >>-[-<+>]
                    # x へ移動
                    <<<<<<< <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]
                    # x の値を演算用領域の値に加算
                    >>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+ <<<<<<<<<<<<<<<
                    [-
                      <<+>>
                      >>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                      >>>>>> [<]+>[->]< <<<<<<
                      <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<]>
                    ]
                    >[-
                      [-<+
                        [<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>>>>>>>>>>>>>>>>>>>>
                        [<] >-[-<+>]< [<]+>[->] >[>]<
                        <<<<<<<<<<<<<<<<<<<<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      <-[+>+
                        <<[<] >>>>>>>>>>>>>>>>>>[>>>>>>>>>>>>>>>>>>]
                        >>>>>>>>>>>>>>>>>>>>>>
                        [<] >-[-<+>] >[>]<
                        <<<<<<<<<<<<<<<<<<<<<<
                        <<<<<<<<<<<<<<<<<<[<<<<<<<<<<<<<<<<<<] >[>]
                      ]
                      ++>[-<->]>
                    ]
                    # x の値を復元
                    <<[-[->+<]<] <[->>+<<]>
                    # GR のフラグをリセット
                    >>>>>>>>>>>>>>>>>>[->>>>>>>>>>>>>>>>>>]
                    # オーバーフローしたビットをリセット
                    >>>>>[-]
                    # IR の元の位置へ移動
                    >>>>>>>>>>>>>>>>>>>>>>>>>>>>
                  ]
                  # 演算用領域へ移動
                  <<<<<<<<<<< <<<<<<<<<<<<<<<<
                  # adr＋x で分岐
                  -[+>-[+>-[+>-[+>-[+>-[+>-[+>-[+>-[+>-[+>-[+>-[+>-[+>-[+  # 0000 0000 0000 00**
                    +>-[+<-  # 0000 0000 0000 000*
                      >>[-  # 0000 0000 0000 0001
                        # IN IBUF，LEN

                        # 演算用領域にフラグをセット
                        <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                        # GR1 へ移動
                        <<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<
                        # GR1 の値 (IBUF) を演算用領域にコピー
                        +>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                        [-
                          [->+
                            <<[<] >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>>
                            >>>> >[>]+<-<[<] <<<<
                            <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<[>]
                          ]
                          >-[+<+
                            [<] >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>>
                            >>>> >[>] <-<[<] <<<<
                            <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<[>]
                          ]
                          +<[->-<]<
                        ]
                        >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                        # 演算用領域へ移動
                        > >>>>>>>>>>>>>>>>>> >>>>>>
                        # 演算用領域の値を MAR に移動
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>++++++++++++++++<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>>>>>>>>>>>>>>>>>>>>>>>+<<<<<<<<<<<<<<<<<<<<<<<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>++++++++++++++++<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>>>>>>>>>>>>>>>>+<<<<<<<<<<<<<<<<<<<]>
                        # MAR の値だけ主記憶にフラグを配置
                        >>>>>>>>>>>>>>>>>>
                        [->>[>>>>]+[<<<<]>>]
                        <[->>>[>>>>]+[<<<<]> >-[->>[>>>>]+[<<<<]>>]<]
                        # 入力
                        # フラグをセットして 1 文字入力
                        <<<<<<<<<<<<<<<<<<<+>>+>,
                        # EOF ならば、フラグをリセットして MAR に －1 をセット
                        ${option.eof === "-1" ? "+" : ""}[<-]<[<]>[-<<->>>>>>>>>>>>>>>>>>>->-<<<<<<<<<<<<<<<<<<]+>${option.eof === "-1" ? "-" : ""}
                        # 改行ならば、フラグをリセット
                        ----------[<-]<[<]>[-<<[-]>>]>++++++++++
                        # フラグが 1 ならば、入力ループ開始
                        <<<[-
                          # 主記憶のフラグを 1 つ追加して、入力を格納する位置をリセット
                          >>>>>>>>>>>>>>>>>>>>>>[>>>>]+>[-]>[-]<<[<<<<]
                          # 入力文字を移動
                          <<<<<<<<<<<<<<<[-
                            >>>>>>>>>>>>>>>
                            >>>>[>>>>] <<+<< [<<<<]
                            <<<<<<<<<<<<<<<
                          ]
                          # MAR をインクリメントして、 0 でないならば次の入力へ移行
                          >>>>>>>>>>>>>>>>+>+[<-]<[<]>[-<+<+>>]<[->+<]<-[+
                            # フラグをセットして 1 文字入力
                            <<<<<<<<<<<<<< <<<+>>+>,
                            # EOF ならば、フラグをリセット
                            ${option.eof === "-1" ? "+" : ""}[<-]<[<]>[-<<->>]+>${option.eof === "-1" ? "-" : ""}
                            # 改行ならば、フラグをリセット
                            ----------[<-]<[<]>[-<<[-]>>]>++++++++++
                            >>>>>>>>>>>>>>
                          ]
                          # フラグの位置へ移動
                          <<<<<<<<<<<<<<<<<
                        ]
                        # 主記憶のフラグをリセット
                        >>>>>>>>>>>>>>>>>> >>>>[>>>>]<<<<[-<<<<]
                        # 演算用領域にフラグをセット
                        <<<<<<<<<<<<<<<[-]<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                        # GR2 へ移動
                        <<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<
                        # GR2 の値 (LEN) を演算用領域にコピー
                        +>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                        [-
                          [->+
                            <<[<] >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>>
                            >>>> >[>]+<-<[<] <<<<
                            <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<[>]
                          ]
                          >-[+<+
                            [<] >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>>
                            >>>> >[>] <-<[<] <<<<
                            <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<[>]
                          ]
                          +<[->-<]<
                        ]
                        >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                        # 演算用領域へ移動
                        > >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>> >>>>>>
                        # 演算用領域の値だけ主記憶にフラグを配置
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>++++++++++++++++<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [-
                          >>>>>>>>>>>>>>>>>>>>>>>>>
                          >>>>[>>>>]+[<<<<]
                          <<<<<<<<<<<<<<<<<<<<<<<<<
                          <-[-
                            >>>>>>>>>>>>>>>>>>>>>>>>>>
                            >>>>[>>>>]+[<<<<]
                            <<<<<<<<<<<<<<<<<<<<<<<<<<
                          ]<
                        ]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>++++++++++++++++<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [-
                          >>>>>>>>>>>>>>>>>
                          >>>>[>>>>]+[<<<<]
                          <<<<<<<<<<<<<<<<<
                        ]
                        # LEN の値をリセット
                        >>>>>>>>>>>>>>>>> >>>>[>>>>]>[-]>[-]<< <<<<[<<<<]
                        # MAR の値を LEN の指す位置に移動
                        >[->>>[>>>>]>+<<<<<[<<<<]>]
                        >[->>[>>>>]>>+<<<<<<[<<<<]>>]
                        # 主記憶のフラグをリセット
                        >>[>>>>]<<<<[-<<<<]
                        # 演算用領域の元の位置へ移動
                        <<<<<<<<<<<<<<<<<
                      ]<
                    ]
                    <[-  # 0000 0000 0000 001*
                      >>-[+  # 0000 0000 0000 0010
                        # OUT OBUF，LEN

                        # 演算用領域にフラグをセット
                        <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                        # GR2 へ移動
                        <<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<
                        # GR2 の値 (LEN) を演算用領域にコピー
                        +>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                        [-
                          [->+
                            <<[<] >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>>
                            >>>> >[>]+<-<[<] <<<<
                            <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<[>]
                          ]
                          >-[+<+
                            [<] >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>>
                            >>>> >[>] <-<[<] <<<<
                            <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<[>]
                          ]
                          +<[->-<]<
                        ]
                        >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                        # 演算用領域へ移動
                        > >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>> >>>>>>
                        # 演算用領域の値を MAR に移動
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>++++++++++++++++<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>>>>>>>>>>>>>>>>>>>>>>>+<<<<<<<<<<<<<<<<<<<<<<<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>++++++++++++++++<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>>>>>>>>>>>>>>>>+<<<<<<<<<<<<<<<<<<<]>
                        # MAR の値だけ主記憶にフラグを配置
                        >>>>>>>>>>>>>>>>>>
                        [->>[>>>>]+[<<<<]>>]
                        <[->>>[>>>>]+[<<<<]> >-[->>[>>>>]+[<<<<]>>]<]
                        # LEN の値を MAR にコピー
                        >>>[>>>>]>
                        [->>>+<<< <<<<<[<<<<]>+>>>[>>>>]>] >>>[-<<<+>>>]<<
                        [->>+<< <<<<<<[<<<<]>>+>>[>>>>]>>] >>[-<<+>>]
                        # 主記憶のフラグをリセット
                        <<<<<<<<[-<<<<]
                        # 演算用領域にフラグをセット
                        <<<<<<<<<<<<<<<<< <+<+<+<+<+<+<+<+<+<+<+<+<+<+<+<+
                        # GR1 へ移動
                        <<<<< <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<
                        # GR1 の値 (OBUF) を演算用領域にコピー
                        +>+>+>+>+>+>+>+>+>+>+>+>+>+>+>+
                        [-
                          [->+
                            <<[<] >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>>
                            >>>> >[>]+<-<[<] <<<<
                            <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<[>]
                          ]
                          >-[+<+
                            [<] >>>>>>>>>>>>>>>>>> >>>>>>>>>>>>>>>>>>
                            >>>> >[>] <-<[<] <<<<
                            <<<<<<<<<<<<<<<<<< <<<<<<<<<<<<<<<<<[>]
                          ]
                          +<[->-<]<
                        ]
                        >>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]>[-<+>]
                        # 演算用領域へ移動
                        > >>>>>>>>>>>>>>>>>> >>>>>>
                        # 演算用領域の値だけ主記憶にフラグを配置
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>++++++++++++++++<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [-
                          >>>>>>>>>>>>>>>>>>>>>>>>>
                          >>>>[>>>>]+[<<<<]
                          <<<<<<<<<<<<<<<<<<<<<<<<<
                          <-[-
                            >>>>>>>>>>>>>>>>>>>>>>>>>>
                            >>>>[>>>>]+[<<<<]
                            <<<<<<<<<<<<<<<<<<<<<<<<<<
                          ]>
                        ]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [->>>>++++++++++++++++<<<<]>
                        [->>>++++++++<<<]> [->>++++<<]> [->++<]>
                        [-
                          >>>>>>>>>>>>>>>>>
                          >>>>[>>>>]+[<<<<]
                          <<<<<<<<<<<<<<<<<
                        ]
                        # MAR へ移動
                        >>>>>>>>>>>>>>>>>>>
                        # 出力
                        [->>[>>>>]>>.<<+[<<<<]>>]
                        <[->>>[>>>>]>>.<<+[<<<<]>> -[->>[>>>>]>>.<<+[<<<<]>>] <]
                        # 主記憶のフラグをリセット
                        >>>[>>>>]<<<<[-<<<<]
                        # 演算用領域の元の位置へ移動
                        <<<<<<<<<<<<<<<<<
                        # 改行 (LF) を出力
                        ++++++++++.[-]
                      ]<<
                    ]
                  ]<]<]<]<]<]<]<]<]<]<]<]<]<]
                  # IR の元の位置へ移動
                  >>>>>>>>>>>>>>>>>>>>>>>>>
                ]<
              ]<
            ]<
          ]<
        ]<
      ]<<
    ]<
  ]

  # (設定された増分)＋1 だけ PR に加算
  <+[-
    >>>>>>>>>>>>>>>
    >>>>[>>>>]+<<<<[<<<<]
    +<+[>-]>[-<<+>>>]<
    <<<<<<<<<<<<<<<
  ]

  # IR の値をリセット
  > >[-]>[-]>[-]>[-]>[-]>[-]>[-]>[-] >[-]>[-]

  # 実行フラグへ移動
  >
]
`;
        return [code, null];
      }
      catch (e) {
        console.error(e);
        return [null, `エラー: 内部エラーが発生しました。\n    ${e}\n\n`];
      }
    };

    const [code, error] = compile();

    output.value = error ?? (option.comment === "disabled" ? code.replace(/[^+\-><[\],.]/g, "") : code);
    output.classList[error !== null ? "add" : "remove"]("error");
  });
})();
