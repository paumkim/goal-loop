// @bun
// src/tui.tsx
import { use as _$use } from "@opentui/solid";
import { createTextNode as _$createTextNode4 } from "@opentui/solid";
import { insertNode as _$insertNode4 } from "@opentui/solid";
import { memo as _$memo4 } from "@opentui/solid";
import { createComponent as _$createComponent4 } from "@opentui/solid";
import { effect as _$effect4 } from "@opentui/solid";
import { insert as _$insert4 } from "@opentui/solid";
import { setProp as _$setProp4 } from "@opentui/solid";
import { createElement as _$createElement4 } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { TextAttributes as TextAttributes4 } from "@opentui/core";
import { useTerminalDimensions as useTerminalDimensions2 } from "@opentui/solid";
import { createMemo, createSignal as createSignal4, createEffect, onCleanup as onCleanup3, Show as Show4 } from "solid-js";

// ../../node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? undefined : "g");
}

// ../../node_modules/strip-ansi/index.js
var regex = ansiRegex();
function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex, "");
}

// ../../node_modules/get-east-asian-width/lookup-data.js
var ambiguousMinimalCodePoint = 161;
var ambiguousMaximumCodePoint = 1114109;
var ambiguousRanges = [161, 161, 164, 164, 167, 168, 170, 170, 173, 174, 176, 180, 182, 186, 188, 191, 198, 198, 208, 208, 215, 216, 222, 225, 230, 230, 232, 234, 236, 237, 240, 240, 242, 243, 247, 250, 252, 252, 254, 254, 257, 257, 273, 273, 275, 275, 283, 283, 294, 295, 299, 299, 305, 307, 312, 312, 319, 322, 324, 324, 328, 331, 333, 333, 338, 339, 358, 359, 363, 363, 462, 462, 464, 464, 466, 466, 468, 468, 470, 470, 472, 472, 474, 474, 476, 476, 593, 593, 609, 609, 708, 708, 711, 711, 713, 715, 717, 717, 720, 720, 728, 731, 733, 733, 735, 735, 768, 879, 913, 929, 931, 937, 945, 961, 963, 969, 1025, 1025, 1040, 1103, 1105, 1105, 8208, 8208, 8211, 8214, 8216, 8217, 8220, 8221, 8224, 8226, 8228, 8231, 8240, 8240, 8242, 8243, 8245, 8245, 8251, 8251, 8254, 8254, 8308, 8308, 8319, 8319, 8321, 8324, 8364, 8364, 8451, 8451, 8453, 8453, 8457, 8457, 8467, 8467, 8470, 8470, 8481, 8482, 8486, 8486, 8491, 8491, 8531, 8532, 8539, 8542, 8544, 8555, 8560, 8569, 8585, 8585, 8592, 8601, 8632, 8633, 8658, 8658, 8660, 8660, 8679, 8679, 8704, 8704, 8706, 8707, 8711, 8712, 8715, 8715, 8719, 8719, 8721, 8721, 8725, 8725, 8730, 8730, 8733, 8736, 8739, 8739, 8741, 8741, 8743, 8748, 8750, 8750, 8756, 8759, 8764, 8765, 8776, 8776, 8780, 8780, 8786, 8786, 8800, 8801, 8804, 8807, 8810, 8811, 8814, 8815, 8834, 8835, 8838, 8839, 8853, 8853, 8857, 8857, 8869, 8869, 8895, 8895, 8978, 8978, 9312, 9449, 9451, 9547, 9552, 9587, 9600, 9615, 9618, 9621, 9632, 9633, 9635, 9641, 9650, 9651, 9654, 9655, 9660, 9661, 9664, 9665, 9670, 9672, 9675, 9675, 9678, 9681, 9698, 9701, 9711, 9711, 9733, 9734, 9737, 9737, 9742, 9743, 9756, 9756, 9758, 9758, 9792, 9792, 9794, 9794, 9824, 9825, 9827, 9829, 9831, 9834, 9836, 9837, 9839, 9839, 9886, 9887, 9919, 9919, 9926, 9933, 9935, 9939, 9941, 9953, 9955, 9955, 9960, 9961, 9963, 9969, 9972, 9972, 9974, 9977, 9979, 9980, 9982, 9983, 10045, 10045, 10102, 10111, 11094, 11097, 12872, 12879, 57344, 63743, 65024, 65039, 65533, 65533, 127232, 127242, 127248, 127277, 127280, 127337, 127344, 127373, 127375, 127376, 127387, 127404, 917760, 917999, 983040, 1048573, 1048576, 1114109];
var fullwidthMinimalCodePoint = 12288;
var fullwidthMaximumCodePoint = 65510;
var fullwidthRanges = [12288, 12288, 65281, 65376, 65504, 65510];
var wideMinimalCodePoint = 4352;
var wideMaximumCodePoint = 262141;
var wideRanges = [4352, 4447, 8986, 8987, 9001, 9002, 9193, 9196, 9200, 9200, 9203, 9203, 9725, 9726, 9748, 9749, 9776, 9783, 9800, 9811, 9855, 9855, 9866, 9871, 9875, 9875, 9889, 9889, 9898, 9899, 9917, 9918, 9924, 9925, 9934, 9934, 9940, 9940, 9962, 9962, 9970, 9971, 9973, 9973, 9978, 9978, 9981, 9981, 9989, 9989, 9994, 9995, 10024, 10024, 10060, 10060, 10062, 10062, 10067, 10069, 10071, 10071, 10133, 10135, 10160, 10160, 10175, 10175, 11035, 11036, 11088, 11088, 11093, 11093, 11904, 11929, 11931, 12019, 12032, 12245, 12272, 12287, 12289, 12350, 12353, 12438, 12441, 12543, 12549, 12591, 12593, 12686, 12688, 12773, 12783, 12830, 12832, 12871, 12880, 42124, 42128, 42182, 43360, 43388, 44032, 55203, 63744, 64255, 65040, 65049, 65072, 65106, 65108, 65126, 65128, 65131, 94176, 94180, 94192, 94198, 94208, 101594, 101631, 101664, 101760, 101874, 101888, 102801, 102816, 102866, 110576, 110579, 110581, 110587, 110589, 110590, 110592, 110888, 110898, 110898, 110928, 110930, 110933, 110933, 110948, 110952, 110960, 111355, 119552, 119638, 119648, 119670, 126980, 126980, 127183, 127183, 127374, 127374, 127377, 127386, 127406, 127406, 127488, 127490, 127504, 127547, 127552, 127560, 127568, 127569, 127584, 127589, 127744, 127776, 127789, 127797, 127799, 127868, 127870, 127891, 127904, 127946, 127951, 127955, 127968, 127984, 127988, 127988, 127992, 128062, 128064, 128064, 128066, 128252, 128255, 128317, 128331, 128334, 128336, 128359, 128378, 128378, 128405, 128406, 128420, 128420, 128507, 128591, 128640, 128709, 128716, 128716, 128720, 128722, 128725, 128729, 128732, 128735, 128747, 128748, 128756, 128764, 128986, 128986, 128992, 129003, 129008, 129008, 129292, 129338, 129340, 129349, 129351, 129535, 129648, 129660, 129664, 129734, 129736, 129736, 129740, 129757, 129759, 129771, 129775, 129786, 131072, 196605, 196608, 262141];

// ../../node_modules/get-east-asian-width/utilities.js
var isInRange = (ranges, codePoint) => {
  let low = 0;
  let high = Math.floor(ranges.length / 2) - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const i = mid * 2;
    if (codePoint < ranges[i]) {
      high = mid - 1;
    } else if (codePoint > ranges[i + 1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
};

// ../../node_modules/get-east-asian-width/lookup.js
var commonCjkCodePoint = 19968;
var [wideFastPathStart, wideFastPathEnd] = /* @__PURE__ */ findWideFastPathRange(wideRanges);
function findWideFastPathRange(ranges) {
  let fastPathStart = ranges[0];
  let fastPathEnd = ranges[1];
  for (let index = 0;index < ranges.length; index += 2) {
    const start = ranges[index];
    const end = ranges[index + 1];
    if (commonCjkCodePoint >= start && commonCjkCodePoint <= end) {
      return [start, end];
    }
    if (end - start > fastPathEnd - fastPathStart) {
      fastPathStart = start;
      fastPathEnd = end;
    }
  }
  return [fastPathStart, fastPathEnd];
}
var isAmbiguous = (codePoint) => {
  if (codePoint < ambiguousMinimalCodePoint || codePoint > ambiguousMaximumCodePoint) {
    return false;
  }
  return isInRange(ambiguousRanges, codePoint);
};
var isFullwidth = (codePoint) => {
  if (codePoint < fullwidthMinimalCodePoint || codePoint > fullwidthMaximumCodePoint) {
    return false;
  }
  return isInRange(fullwidthRanges, codePoint);
};
var isWide = (codePoint) => {
  if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) {
    return true;
  }
  if (codePoint < wideMinimalCodePoint || codePoint > wideMaximumCodePoint) {
    return false;
  }
  return isInRange(wideRanges, codePoint);
};

// ../../node_modules/get-east-asian-width/index.js
function validate(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate(codePoint);
  if (isFullwidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// ../../node_modules/emoji-regex/index.mjs
var emoji_regex_default = () => {
  return /[#*0-9]\uFE0F?\u20E3|[\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23ED-\u23EF\u23F1\u23F2\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB\u25FC\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692\u2694-\u2697\u2699\u269B\u269C\u26A0\u26A7\u26AA\u26B0\u26B1\u26BD\u26BE\u26C4\u26C8\u26CF\u26D1\u26E9\u26F0-\u26F5\u26F7\u26F8\u26FA\u2702\u2708\u2709\u270F\u2712\u2714\u2716\u271D\u2721\u2733\u2734\u2744\u2747\u2757\u2763\u27A1\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B55\u3030\u303D\u3297\u3299]\uFE0F?|[\u261D\u270C\u270D](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\u270A\u270B](?:\uD83C[\uDFFB-\uDFFF])?|[\u23E9-\u23EC\u23F0\u23F3\u25FD\u2693\u26A1\u26AB\u26C5\u26CE\u26D4\u26EA\u26FD\u2705\u2728\u274C\u274E\u2753-\u2755\u2795-\u2797\u27B0\u27BF\u2B50]|\u26D3\uFE0F?(?:\u200D\uD83D\uDCA5)?|\u26F9(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\u2764\uFE0F?(?:\u200D(?:\uD83D\uDD25|\uD83E\uDE79))?|\uD83C(?:[\uDC04\uDD70\uDD71\uDD7E\uDD7F\uDE02\uDE37\uDF21\uDF24-\uDF2C\uDF36\uDF7D\uDF96\uDF97\uDF99-\uDF9B\uDF9E\uDF9F\uDFCD\uDFCE\uDFD4-\uDFDF\uDFF5\uDFF7]\uFE0F?|[\uDF85\uDFC2\uDFC7](?:\uD83C[\uDFFB-\uDFFF])?|[\uDFC4\uDFCA](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDFCB\uDFCC](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDCCF\uDD8E\uDD91-\uDD9A\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF43\uDF45-\uDF4A\uDF4C-\uDF7C\uDF7E-\uDF84\uDF86-\uDF93\uDFA0-\uDFC1\uDFC5\uDFC6\uDFC8\uDFC9\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF8-\uDFFF]|\uDDE6\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF]|\uDDE7\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF]|\uDDE8\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF7\uDDFA-\uDDFF]|\uDDE9\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF]|\uDDEA\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA]|\uDDEB\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7]|\uDDEC\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE]|\uDDED\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA]|\uDDEE\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9]|\uDDEF\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5]|\uDDF0\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF]|\uDDF1\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE]|\uDDF2\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF]|\uDDF3\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF]|\uDDF4\uD83C\uDDF2|\uDDF5\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE]|\uDDF6\uD83C\uDDE6|\uDDF7\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC]|\uDDF8\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF]|\uDDF9\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF]|\uDDFA\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF]|\uDDFB\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA]|\uDDFC\uD83C[\uDDEB\uDDF8]|\uDDFD\uD83C\uDDF0|\uDDFE\uD83C[\uDDEA\uDDF9]|\uDDFF\uD83C[\uDDE6\uDDF2\uDDFC]|\uDF44(?:\u200D\uD83D\uDFEB)?|\uDF4B(?:\u200D\uD83D\uDFE9)?|\uDFC3(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDFF3\uFE0F?(?:\u200D(?:\u26A7\uFE0F?|\uD83C\uDF08))?|\uDFF4(?:\u200D\u2620\uFE0F?|\uDB40\uDC67\uDB40\uDC62\uDB40(?:\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDC73\uDB40\uDC63\uDB40\uDC74|\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F)?)|\uD83D(?:[\uDC3F\uDCFD\uDD49\uDD4A\uDD6F\uDD70\uDD73\uDD76-\uDD79\uDD87\uDD8A-\uDD8D\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA\uDECB\uDECD-\uDECF\uDEE0-\uDEE5\uDEE9\uDEF0\uDEF3]\uFE0F?|[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDC8F\uDC91\uDCAA\uDD7A\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC](?:\uD83C[\uDFFB-\uDFFF])?|[\uDC6E-\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4\uDEB5](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD74\uDD90](?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?|[\uDC00-\uDC07\uDC09-\uDC14\uDC16-\uDC25\uDC27-\uDC3A\uDC3C-\uDC3E\uDC40\uDC44\uDC45\uDC51-\uDC65\uDC6A\uDC79-\uDC7B\uDC7D-\uDC80\uDC84\uDC88-\uDC8E\uDC90\uDC92-\uDCA9\uDCAB-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDDA4\uDDFB-\uDE2D\uDE2F-\uDE34\uDE37-\uDE41\uDE43\uDE44\uDE48-\uDE4A\uDE80-\uDEA2\uDEA4-\uDEB3\uDEB7-\uDEBF\uDEC1-\uDEC5\uDED0-\uDED2\uDED5-\uDED8\uDEDC-\uDEDF\uDEEB\uDEEC\uDEF4-\uDEFC\uDFE0-\uDFEB\uDFF0]|\uDC08(?:\u200D\u2B1B)?|\uDC15(?:\u200D\uD83E\uDDBA)?|\uDC26(?:\u200D(?:\u2B1B|\uD83D\uDD25))?|\uDC3B(?:\u200D\u2744\uFE0F?)?|\uDC41\uFE0F?(?:\u200D\uD83D\uDDE8\uFE0F?)?|\uDC68(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDC68\uDC69]\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?)|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFC-\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFD-\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFD\uDFFF]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?\uDC68\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDD1D\uDEEF]\u200D\uD83D\uDC68\uD83C[\uDFFB-\uDFFE]|[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3])))?))?|\uDC69(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:\uDC8B\u200D\uD83D)?[\uDC68\uDC69]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?|\uDC69\u200D\uD83D(?:\uDC66(?:\u200D\uD83D\uDC66)?|\uDC67(?:\u200D\uD83D[\uDC66\uDC67])?))|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFC-\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFD-\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFD\uDFFF]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D\uD83D(?:[\uDC68\uDC69]|\uDC8B\u200D\uD83D[\uDC68\uDC69])\uD83C[\uDFFB-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3]|\uDD1D\u200D\uD83D[\uDC68\uDC69]\uD83C[\uDFFB-\uDFFE]|\uDEEF\u200D\uD83D\uDC69\uD83C[\uDFFB-\uDFFE])))?))?|\uDD75(?:\uD83C[\uDFFB-\uDFFF]|\uFE0F)?(?:\u200D[\u2640\u2642]\uFE0F?)?|\uDE2E(?:\u200D\uD83D\uDCA8)?|\uDE35(?:\u200D\uD83D\uDCAB)?|\uDE36(?:\u200D\uD83C\uDF2B\uFE0F?)?|\uDE42(?:\u200D[\u2194\u2195]\uFE0F?)?|\uDEB6(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?)|\uD83E(?:[\uDD0C\uDD0F\uDD18-\uDD1F\uDD30-\uDD34\uDD36\uDD77\uDDB5\uDDB6\uDDBB\uDDD2\uDDD3\uDDD5\uDEC3-\uDEC5\uDEF0\uDEF2-\uDEF8](?:\uD83C[\uDFFB-\uDFFF])?|[\uDD26\uDD35\uDD37-\uDD39\uDD3C-\uDD3E\uDDB8\uDDB9\uDDCD\uDDCF\uDDD4\uDDD6-\uDDDD](?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDDDE\uDDDF](?:\u200D[\u2640\u2642]\uFE0F?)?|[\uDD0D\uDD0E\uDD10-\uDD17\uDD20-\uDD25\uDD27-\uDD2F\uDD3A\uDD3F-\uDD45\uDD47-\uDD76\uDD78-\uDDB4\uDDB7\uDDBA\uDDBC-\uDDCC\uDDD0\uDDE0-\uDDFF\uDE70-\uDE7C\uDE80-\uDE8A\uDE8E-\uDEC2\uDEC6\uDEC8\uDECD-\uDEDC\uDEDF-\uDEEA\uDEEF]|\uDDCE(?:\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:[\u2640\u2642]\uFE0F?(?:\u200D\u27A1\uFE0F?)?|\u27A1\uFE0F?))?|\uDDD1(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1|\uDDD1\u200D\uD83E\uDDD2(?:\u200D\uD83E\uDDD2)?|\uDDD2(?:\u200D\uD83E\uDDD2)?))|\uD83C(?:\uDFFB(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFC-\uDFFF])))?|\uDFFC(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFD-\uDFFF])))?|\uDFFD(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])))?|\uDFFE(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFD\uDFFF])))?|\uDFFF(?:\u200D(?:[\u2695\u2696\u2708]\uFE0F?|\u2764\uFE0F?\u200D(?:\uD83D\uDC8B\u200D)?\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE]|\uD83C[\uDF3E\uDF73\uDF7C\uDF84\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D(?:[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uDC30\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE])|\uD83E(?:[\uDDAF\uDDBC\uDDBD](?:\u200D\u27A1\uFE0F?)?|[\uDDB0-\uDDB3\uDE70]|\uDD1D\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFF]|\uDEEF\u200D\uD83E\uDDD1\uD83C[\uDFFB-\uDFFE])))?))?|\uDEF1(?:\uD83C(?:\uDFFB(?:\u200D\uD83E\uDEF2\uD83C[\uDFFC-\uDFFF])?|\uDFFC(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFD-\uDFFF])?|\uDFFD(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])?|\uDFFE(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFD\uDFFF])?|\uDFFF(?:\u200D\uD83E\uDEF2\uD83C[\uDFFB-\uDFFE])?))?)/g;
};

// ../../node_modules/string-width/index.js
var segmenter = new Intl.Segmenter;
var defaultIgnorableCodePointRegex = /^\p{Default_Ignorable_Code_Point}$/u;
function stringWidth(string, options = {}) {
  if (typeof string !== "string" || string.length === 0) {
    return 0;
  }
  const {
    ambiguousIsNarrow = true,
    countAnsiEscapeCodes = false
  } = options;
  if (!countAnsiEscapeCodes) {
    string = stripAnsi(string);
  }
  if (string.length === 0) {
    return 0;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment: character } of segmenter.segment(string)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 31 || codePoint >= 127 && codePoint <= 159) {
      continue;
    }
    if (codePoint >= 8203 && codePoint <= 8207 || codePoint === 65279) {
      continue;
    }
    if (codePoint >= 768 && codePoint <= 879 || codePoint >= 6832 && codePoint <= 6911 || codePoint >= 7616 && codePoint <= 7679 || codePoint >= 8400 && codePoint <= 8447 || codePoint >= 65056 && codePoint <= 65071) {
      continue;
    }
    if (codePoint >= 55296 && codePoint <= 57343) {
      continue;
    }
    if (codePoint >= 65024 && codePoint <= 65039) {
      continue;
    }
    if (defaultIgnorableCodePointRegex.test(character)) {
      continue;
    }
    if (emoji_regex_default().test(character)) {
      width += 2;
      continue;
    }
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
  }
  return width;
}

// src/core/types.ts
var LIVE_STATUSES = new Set(["active", "paused"]);
var isLive = (status) => LIVE_STATUSES.has(status);
var COMPACT_MISS_CAP = 4;

// src/core/format.ts
var segmenter2 = new Intl.Segmenter("en", { granularity: "grapheme" });
function wrapLines(text, width) {
  const max = Math.max(1, Math.floor(width));
  let lines = 1;
  let used = 0;
  for (const word of text.split(" ")) {
    if (word === "")
      continue;
    const w = stringWidth(word);
    const sep = used === 0 ? 0 : 1;
    if (used > 0 && used + sep + w > max) {
      lines += 1;
      used = 0;
    }
    if (w > max) {
      const extra = Math.floor((w - 1) / max);
      lines += extra;
      used = w % max === 0 ? max : w % max;
    } else {
      used += (used === 0 ? 0 : 1) + w;
    }
  }
  return lines;
}
var GOAL_GLYPH = "\u25CE";
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  if (h > 0)
    return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0)
    return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
function formatDurationCoarse(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1)
    return "<1m";
  if (minutes < 60)
    return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}
function formatTokens(n) {
  if (n < 1000)
    return String(Math.round(n));
  const k = (n / 1000).toFixed(n < 1e4 ? 1 : 0);
  if (n < 1e6 && Number(k) < 1000)
    return `${k}k`;
  return `${(n / 1e6).toFixed(2)}M`;
}
function formatCost(usd) {
  if (usd <= 0)
    return "$0";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}
function formatSpend(spend) {
  const parts = [`${formatTokens(spend.input + spend.cacheRead + spend.cacheWrite)} in`, `${formatTokens(spend.output + spend.reasoning)} out`];
  if (spend.cacheRead > 0)
    parts.push(`${formatTokens(spend.cacheRead)} cached`);
  if (spend.cost > 0)
    parts.push(formatCost(spend.cost));
  return parts.join(" \xB7 ");
}
function truncate(text, max) {
  if (max <= 0)
    return "";
  const flat = text.replace(/\s+/g, " ").trim();
  if (stringWidth(flat) <= max)
    return flat;
  const budget = max - 1;
  let out = "";
  let used = 0;
  for (const { segment } of segmenter2.segment(flat)) {
    const w = stringWidth(segment);
    if (used + w > budget)
      break;
    out += segment;
    used += w;
  }
  return `${out.replace(/\s+$/, "")}\u2026`;
}

// src/status-dialog.tsx
import { createTextNode as _$createTextNode2 } from "@opentui/solid";
import { memo as _$memo2 } from "@opentui/solid";
import { createComponent as _$createComponent2 } from "@opentui/solid";
import { insertNode as _$insertNode2 } from "@opentui/solid";
import { effect as _$effect2 } from "@opentui/solid";
import { insert as _$insert2 } from "@opentui/solid";
import { setProp as _$setProp2 } from "@opentui/solid";
import { createElement as _$createElement2 } from "@opentui/solid";
import { Show as Show2, createSignal as createSignal2, onCleanup as onCleanup2 } from "solid-js";
import { TextAttributes as TextAttributes2 } from "@opentui/core";

// src/core/history.ts
var BAR_CELLS = 18;
var LABEL = 10;
var BAR_FILLED = "\u2588";
var BAR_EMPTY = "\u2591";
var BAR_FILLED_ASCII = "#";
var BAR_EMPTY_ASCII = "-";
function renderBar(done, max, cells = BAR_CELLS, ascii = false) {
  const width = Math.max(1, Math.floor(cells));
  const safeMax = typeof max === "number" && Number.isFinite(max) && max > 0 ? max : 0;
  const safeDone = Number.isFinite(done) ? Math.max(0, done) : 0;
  const filled = safeMax === 0 ? 0 : Math.min(width, Math.max(0, Math.round(safeDone / safeMax * width)));
  const filledGlyph = ascii ? BAR_FILLED_ASCII : BAR_FILLED;
  const emptyGlyph = ascii ? BAR_EMPTY_ASCII : BAR_EMPTY;
  return { filled, text: filledGlyph.repeat(filled) + emptyGlyph.repeat(width - filled) };
}
function barCaption(current, max, done) {
  const safeDone = Number.isFinite(done) ? Math.max(0, done) : 0;
  const v = Number.isFinite(current) && current >= 1 ? Math.floor(current) : 1;
  return typeof max === "number" && Number.isFinite(max) && max > 0 ? `v${v} of at most ${Math.floor(max)} \xB7 ${safeDone} complete` : `v${v} \xB7 ${safeDone} complete`;
}
function verdictGlyph(verdict) {
  switch (verdict) {
    case "met":
      return "\u2713";
    case "impossible":
      return "\u2298";
    default:
      return "\u2717";
  }
}
function iterationDurations(entries, setAt) {
  const out = [];
  let previous = setAt;
  for (const entry of entries) {
    const span = Number.isFinite(entry.endedAt) ? entry.endedAt - previous : 0;
    out.push(Math.max(0, span));
    previous = Number.isFinite(entry.endedAt) ? entry.endedAt : previous;
  }
  return out;
}
function trailWindow(history, limit = 24) {
  const total = history.length;
  const shown = limit >= total ? history : history.slice(total - limit);
  return { shown, total };
}
function verdictCounts(history) {
  let met = 0;
  let not_met = 0;
  let impossible = 0;
  for (const entry of history) {
    if (entry.verdict === "met")
      met += 1;
    else if (entry.verdict === "impossible")
      impossible += 1;
    else
      not_met += 1;
  }
  return { met, not_met, impossible, total: history.length };
}
function lastVerdict(history) {
  return history.length === 0 ? undefined : history[history.length - 1];
}
var PIP_FILLED = "\u25CF";
var PIP_EMPTY = "\u25CB";
var PIP_FILLED_ASCII = "#";
var PIP_EMPTY_ASCII = "-";
function renderPips(done, max, ascii = false) {
  if (typeof max !== "number" || !Number.isFinite(max))
    return "";
  const cap = Math.floor(max);
  if (cap < 1 || cap > 8)
    return "";
  const filled = Math.min(Math.max(0, Math.floor(Number.isFinite(done) ? done : 0)), cap);
  const filledGlyph = ascii ? PIP_FILLED_ASCII : PIP_FILLED;
  const emptyGlyph = ascii ? PIP_EMPTY_ASCII : PIP_EMPTY;
  return filledGlyph.repeat(filled) + emptyGlyph.repeat(cap - filled);
}
function paceEstimate(durations, max) {
  if (durations.length === 0)
    return;
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0)
    return;
  const left = Math.floor(max) - durations.length;
  if (left <= 0)
    return;
  const perIteration = durations.reduce((sum, span) => sum + span, 0) / durations.length;
  return { perIteration, remaining: perIteration * left };
}
function iterationVerdictMix(history, entries, setAt) {
  const out = [];
  let start = setAt;
  for (const entry of entries) {
    const end = entry.endedAt;
    const slice = history.filter((verdict) => verdict.at > start && verdict.at <= end);
    out.push(slice.length === 0 ? undefined : verdictCounts(slice));
    start = end;
  }
  return out;
}
function verdictStreak(history) {
  const last = history[history.length - 1];
  if (!last)
    return { verdict: undefined, count: 0 };
  let count = 1;
  for (let index = history.length - 2;index >= 0; index -= 1) {
    if (history[index]?.verdict !== last.verdict)
      break;
    count += 1;
  }
  return { verdict: last.verdict, count };
}
function relativeTime(endedAt, nowMs) {
  const delta = Math.max(0, nowMs - endedAt);
  if (!Number.isFinite(delta))
    return "just now";
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1)
    return "just now";
  if (minutes < 60)
    return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}
function pauseDiagnostics(stall, retries) {
  const clean = (value) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `stall ${clean(stall)} \xB7 retries ${clean(retries)}`;
}
function loopTotals(entries, setAt) {
  let turns = 0;
  let tools = 0;
  let lastEnded = 0;
  for (const entry of entries) {
    turns += Number.isFinite(entry.turns) ? entry.turns : 0;
    tools += Number.isFinite(entry.toolCalls) ? entry.toolCalls : 0;
    if (Number.isFinite(entry.endedAt) && entry.endedAt > lastEnded)
      lastEnded = entry.endedAt;
  }
  const spanMs = entries.length === 0 ? 0 : Math.max(0, lastEnded - setAt);
  return { iterations: entries.length, turns, tools, spanMs };
}
function localTime(ms) {
  if (!Number.isFinite(ms))
    return "--:--";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime()))
    return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function currentIterationVerdict(history, entries, setAt) {
  const from = entries.length > 0 ? entries[entries.length - 1].endedAt : setAt;
  for (let index = history.length - 1;index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.at > from)
      return entry;
    break;
  }
  return;
}
function turnsSinceVerdict(turns, verdictTurn) {
  if (!Number.isFinite(turns) || !Number.isFinite(verdictTurn))
    return 0;
  return Math.max(0, Math.floor(turns) - Math.floor(verdictTurn));
}
function durationShares(durations) {
  const total = durations.reduce((sum, span) => sum + Math.max(0, Number.isFinite(span) ? span : 0), 0);
  if (total <= 0)
    return durations.map(() => 0);
  return durations.map((span) => Math.round(Math.max(0, Number.isFinite(span) ? span : 0) / total * 100));
}
var SPARK_GLYPHS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
var SPARK_GLYPHS_ASCII = [".", ":", "-", "=", "+", "*", "#", "@"];
var SPARK_GAP_ASCII = " ";
var SPARK_TRUNC_ASCII = ">";
var SPARK_MAX_CELLS = 16;
function contextSparkline(entries, ascii = false) {
  const estimates = entries.map((entry) => typeof entry.contextTokens === "number" && Number.isFinite(entry.contextTokens) && entry.contextTokens >= 0 ? entry.contextTokens : undefined);
  const present = estimates.filter((value) => value !== undefined);
  if (present.length === 0)
    return;
  const peak = Math.max(...present);
  let latest = 0;
  for (let index = estimates.length - 1;index >= 0; index -= 1) {
    const value = estimates[index];
    if (value !== undefined) {
      latest = value;
      break;
    }
  }
  const window = estimates.slice(-SPARK_MAX_CELLS);
  const truncated = window.length < estimates.length;
  const ramp = ascii ? SPARK_GLYPHS_ASCII : SPARK_GLYPHS;
  const gap = ascii ? SPARK_GAP_ASCII : "\xB7";
  const truncatedMarker = ascii ? SPARK_TRUNC_ASCII : "\u2026";
  const bars = window.map((value) => {
    if (value === undefined)
      return gap;
    if (peak === 0)
      return ramp[0];
    return ramp[Math.min(7, Math.floor(value / peak * 8))];
  }).join("");
  return { bars: (truncated ? truncatedMarker : "") + bars, peak, latest, shown: present.length, truncated };
}
var CONTEXT_BAR_CELLS = 16;
var CONTEXT_HOT_RATIO = 0.8;
function contextMeter(size, capacity, cells = CONTEXT_BAR_CELLS, ascii = false) {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  const width = Math.max(1, Math.floor(cells));
  const hasCapacity = typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0;
  const filledGlyph = ascii ? BAR_FILLED_ASCII : BAR_FILLED;
  const emptyGlyph = ascii ? BAR_EMPTY_ASCII : BAR_EMPTY;
  if (!hasCapacity)
    return { filled: 0, text: emptyGlyph.repeat(width), pct: undefined, hot: false, over: false };
  const ratio = safeSize / capacity;
  const pct = Math.round(ratio * 100);
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  return {
    filled,
    text: filledGlyph.repeat(filled) + emptyGlyph.repeat(width - filled),
    pct,
    hot: ratio >= CONTEXT_HOT_RATIO,
    over: ratio >= 1
  };
}

// src/core/hud.ts
var RETRY_HOT_THRESHOLD = 3;
var isRetryStuck = (goal) => goal.retries >= RETRY_HOT_THRESHOLD;
var isCompactHot = (goal) => {
  const pending = goal.loopCompact;
  return Boolean(pending && pending.landedAt === undefined && pending.misses >= 2);
};
var stateWord = (goal) => goal.status === "paused" ? "paused" : goal.evaluating ? "checking" : goal.waiting ? "waiting" : isRetryStuck(goal) ? "stuck" : "active";
var pillCaret = (open, ascii = false) => open ? ascii ? "v" : "\u25BE" : ascii ? ">" : "\u25B8";
var fitLadder = (rungs, budget) => {
  for (const rung of rungs) {
    if (stringWidth(rung) <= budget)
      return rung;
  }
  return truncate(rungs[rungs.length - 1], Math.max(0, Math.floor(budget)));
};
var pillModel = (goal, elapsed, ascii = false, budget = Number.POSITIVE_INFINITY) => {
  const state = stateWord(goal);
  const turns = goal.turns > 0 ? ` \xB7 ${goal.turns} turn${goal.turns === 1 ? "" : "s"}` : "";
  const retrying = isRetryStuck(goal) ? ` \xB7 retry ${goal.retries}` : "";
  const tone = goal.status === "paused" ? "paused" : isRetryStuck(goal) ? "retrying" : isCompactHot(goal) ? "hot" : goal.evaluating ? "evaluating" : goal.waiting ? "waiting" : "armed";
  if (goal.loopEnabled) {
    const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : "";
    const pips = renderPips(goal.loopHistory?.length ?? 0, goal.loopMaxLoops, ascii);
    const pending = goal.loopCompact && !goal.loopCompact.landedAt ? goal.loopCompact : undefined;
    const compacting = pending ? ` \xB7 compact pending${pending.misses > 0 ? ` (${pending.misses}/${COMPACT_MISS_CAP})` : ""}` : "";
    const core = `${GOAL_GLYPH} loop \xB7 v${goal.loopIteration ?? 1}${cap}`;
    const head = ` \xB7 ${state} \xB7 ${formatDurationCoarse(elapsed)}`;
    const pipSeg = pips ? ` ${pips}` : "";
    const text = fitLadder([`${core}${pipSeg}${head}${turns}${compacting}${retrying}`, `${core}${pipSeg}${head}${turns}${compacting}`, `${core}${pipSeg}${head}${turns}`, `${core}${pipSeg}${head}`, `${core}${head}`], budget);
    return { text, tone };
  }
  const core = `${GOAL_GLYPH} goal ${state} \xB7 ${formatDurationCoarse(elapsed)}`;
  const text = fitLadder([`${core}${turns}${retrying}`, `${core}${turns}`, core], budget);
  return { text, tone };
};
var TERMINAL_ACK_MS = 45000;
var ACK_FLASH_MS = 1700;
var LANDING_ACK_MS = 3000;
var LANDING_SUFFIX = " \xB7 landed \u2713";
var pillMotionNeeded = (args) => args.evaluating === true || args.hot === true || args.flashing === true || args.landing === true;
var terminalPill = (goal, elapsed) => {
  const tone = goal.status === "achieved" ? "achieved" : goal.status === "impossible" ? "impossible" : goal.status === "failed" ? "failed" : undefined;
  if (!tone)
    return;
  const word = goal.status === "achieved" ? goal.loopEnabled ? "complete" : "achieved" : goal.status;
  const turns = goal.turns > 0 ? ` \xB7 ${goal.turns} turn${goal.turns === 1 ? "" : "s"}` : "";
  const span = `${formatDurationCoarse(elapsed)}${turns}`;
  if (goal.loopEnabled) {
    const cap = typeof goal.loopMaxLoops === "number" && goal.loopMaxLoops > 0 ? `/${goal.loopMaxLoops}` : "";
    const iteration = Math.max(1, goal.loopIteration ?? (goal.loopHistory?.length ?? 0) + 1);
    return { text: `${GOAL_GLYPH} loop ${word} \xB7 v${iteration}${cap} \xB7 ${span}`, tone };
  }
  return { text: `${GOAL_GLYPH} goal ${word} \xB7 ${span}`, tone };
};
var PIN_MIN_WIDTH = 12;
var PIN_PREFIX = " \xB7 pin: ";
var pinSuffix = (condition, conditionMax) => {
  const budget = Math.floor(conditionMax);
  if (!Number.isFinite(budget) || budget < PIN_MIN_WIDTH)
    return "";
  const flat = condition.replace(/\s+/g, " ").trim();
  if (flat.length === 0)
    return "";
  return `${PIN_PREFIX}${truncate(flat, budget)}`;
};
var motionDisabled = (env) => env.NO_COLOR !== undefined || env.TERM === "dumb";
var stateAccentColor = (theme, status, stuck, mono) => {
  if (mono)
    return status === "cleared" ? theme.text.faint : theme.text.base;
  if (status === "paused" || status === "impossible")
    return theme.text.feedback.warning.base;
  if (status === "active")
    return stuck ? theme.text.feedback.warning.base : theme.text.feedback.info.base;
  if (status === "achieved")
    return theme.text.feedback.info.base;
  if (status === "failed")
    return theme.text.feedback.error?.base ?? theme.text.feedback.warning.base;
  return theme.text.faint;
};
var borderAccentColor = (theme, status, accent, mono) => {
  if (mono)
    return theme.border?.base ?? theme.text.faint;
  if (status === "achieved")
    return theme.text.feedback.info.base;
  if (status === "failed")
    return theme.text.feedback.error?.base ?? theme.text.feedback.warning.base;
  if (status === "impossible" || status === "paused" || accent.hot === true || accent.stuck === true)
    return theme.text.feedback.warning.base;
  return theme.border?.base ?? theme.text.faint;
};
var verdictAccentColor = (theme, verdict, mono) => {
  if (verdict === "met")
    return mono ? theme.text.base : theme.text.feedback.info.base;
  if (verdict === "impossible")
    return mono ? theme.text.base : theme.text.feedback.warning.base;
  return theme.text.faint;
};
var fixAccentColor = (theme, tone, mono) => {
  if (mono)
    return theme.text.base;
  return tone === "error" ? theme.text.feedback.error?.base ?? theme.text.feedback.warning.base : theme.text.feedback.warning.base;
};
var remediationFor = (goal) => {
  if (goal.status === "failed") {
    const label = goal.failureLabel;
    return { tone: "error", text: label ? `${label} \u2014 /goal clear to reset` : `goal failed \u2014 /goal clear to reset` };
  }
  if (goal.status === "impossible") {
    return { tone: "warning", text: `judged impossible \xB7 rephrase the condition, else /goal clear` };
  }
  if (goal.status === "paused") {
    const cause = goal.pauseCause;
    if (cause === "cap")
      return { tone: "warning", text: `turn cap reached \xB7 /goal clear or set a new goal \u2014 a message will not extend it` };
    if (cause === "stall")
      return { tone: "warning", text: `no tool use for ${Math.max(0, Math.floor(goal.stall))} turns \xB7 send a message to resume, or /goal clear` };
    if (cause === "user")
      return { tone: "warning", text: `interrupted \xB7 send a message to resume` };
    return { tone: "warning", text: `paused \xB7 send a message to resume, or /goal clear` };
  }
  if (isRetryStuck(goal)) {
    return { tone: "warning", text: `${goal.retries} failed turns in a row \xB7 check provider quota or settings \xB7 else /goal clear` };
  }
  const pending = goal.loopCompact && goal.loopCompact.landedAt === undefined ? goal.loopCompact : undefined;
  if (pending && pending.misses >= 2) {
    return {
      tone: "warning",
      text: `compact pending ${pending.misses}/${COMPACT_MISS_CAP} \xB7 send a message for a safe point \xB7 else set evaluator.verifyCommand`
    };
  }
  const streak = verdictStreak(goal.history ?? []);
  if (streak.verdict === "not_met" && streak.count >= 3) {
    return {
      tone: "warning",
      text: `${streak.count}\xD7 not_met in a row \xB7 consider evaluator.verifyCommand`
    };
  }
  return;
};
var EVALUATOR_HINT_CARD = "the evaluator reads only the transcript";
var EVALUATOR_HINT_FULL = "the evaluator reads only the transcript \u2014 it cannot run commands; prove the condition with visible output";
var evaluatorHint = (goal) => {
  if (goal.status !== "active")
    return null;
  if (goal.turns > 0)
    return null;
  if ((goal.history?.length ?? 0) > 0)
    return null;
  if (remediationFor(goal))
    return null;
  return { card: EVALUATOR_HINT_CARD, full: EVALUATOR_HINT_FULL };
};

// src/tui-history.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { For, Show, createSignal, onCleanup } from "solid-js";
var SUMMARY_MAX = 400;
var RAIL_VISIBLE = 4;
var label = (theme, text) => (() => {
  var _el$ = _$createElement("text");
  _$setProp(_el$, "flexShrink", 0);
  _$setProp(_el$, "width", LABEL);
  _$insert(_el$, text);
  _$effect((_$p) => _$setProp(_el$, "fg", theme.text.faint, _$p));
  return _el$;
})();
var colorFor = (theme, verdict, mono) => verdictAccentColor(theme, verdict, mono);
var RailSummary = (props) => {
  const [hovered, setHovered] = createSignal(false);
  const copy = () => {
    if (!props.onCopy)
      return;
    try {
      props.onCopy(props.text);
    } catch {}
  };
  return (() => {
    var _el$2 = _$createElement("box"), _el$3 = _$createElement("text"), _el$5 = _$createElement("text");
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$5);
    _$setProp(_el$2, "flexDirection", "row");
    _$setProp(_el$2, "gap", 2);
    _$setProp(_el$2, "onMouseOver", () => setHovered(true));
    _$setProp(_el$2, "onMouseOut", () => setHovered(false));
    _$insertNode(_el$3, _$createTextNode(`\u2502`));
    _$setProp(_el$3, "flexShrink", 0);
    _$setProp(_el$3, "width", LABEL);
    _$setProp(_el$5, "wrapMode", "word");
    _$setProp(_el$5, "flexGrow", 1);
    _$insert(_el$5, () => `\u2502 ${truncate(props.text, SUMMARY_MAX)}`, null);
    _$insert(_el$5, () => props.copied?.() ? " \u2713 copied" : "", null);
    _$effect((_p$) => {
      var _v$ = props.onCopy ? (event) => {
        if (event.button !== 0)
          return;
        event.stopPropagation();
        copy();
      } : undefined, _v$2 = props.theme.text.faint, _v$3 = props.theme.text.faint, _v$4 = props.onCopy && hovered() ? TextAttributes.UNDERLINE : undefined;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "onMouseUp", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$5, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$5, "attributes", _v$4, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$2;
  })();
};
var LoopSection = (props) => {
  const theme = () => props.theme;
  const mono = () => props.mono === true;
  const ascii = motionDisabled(process.env);
  const [copiedVersion, setCopiedVersion] = createSignal(null);
  let copiedTimer;
  onCleanup(() => {
    if (copiedTimer)
      clearTimeout(copiedTimer);
  });
  const copySummary = (summary, version) => {
    if (!props.onCopySummary)
      return;
    try {
      props.onCopySummary(summary, version);
      setCopiedVersion(version);
      if (copiedTimer)
        clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setCopiedVersion(null), 1600);
    } catch {}
  };
  const history = () => props.goal.loopHistory ?? [];
  const done = () => history().length;
  const [showAll, setShowAll] = createSignal(false);
  const [railHovered, setRailHovered] = createSignal(false);
  const hiddenCount = () => showAll() ? 0 : Math.max(0, done() - RAIL_VISIBLE);
  const visibleHistory = () => showAll() ? history() : history().slice(-RAIL_VISIBLE);
  const railOffset = () => Math.max(0, done() - visibleHistory().length);
  const max = () => props.goal.loopMaxLoops;
  const current = () => Math.max(1, props.goal.loopIteration ?? done() + 1);
  const bar = () => renderBar(done(), max(), BAR_CELLS, ascii);
  const filledBarText = () => bar().text.slice(0, bar().filled);
  const emptyBarText = () => bar().text.slice(bar().filled);
  const durations = () => iterationDurations(history(), props.goal.setAt);
  const shares = () => durationShares(durations());
  const shareSuffix = (index) => shares()[index] === undefined ? "" : ` \xB7 ${shares()[index]}% of wall`;
  const pace = () => paceEstimate(durations(), max());
  const mixes = () => iterationVerdictMix(props.goal.history ?? [], history(), props.goal.setAt);
  const spark = () => contextSparkline(history(), ascii);
  const mixSuffix = (index) => {
    const mix = mixes()[index];
    return mix ? ` \xB7 ${mix.met}\u2713 ${mix.not_met}\u2717${mix.impossible > 0 ? ` ${mix.impossible}\u2298` : ""}` : "";
  };
  const endedSuffix = (entry) => ` \xB7 ended ${relativeTime(entry.endedAt, nowMs())} at ${localTime(entry.endedAt)}`;
  const paused = () => props.goal.status === "paused";
  const stateWord = () => {
    const s = props.goal.status;
    if (s === "paused")
      return "paused";
    if (s !== "active")
      return s;
    return props.goal.evaluating ? "checking" : props.goal.waiting ? "waiting" : "active";
  };
  const nowMs = () => props.nowMs?.() ?? Date.now();
  const iterVerdict = () => currentIterationVerdict(props.goal.history ?? [], history(), props.goal.setAt);
  const turnsSince = () => {
    const v = iterVerdict();
    return v ? turnsSinceVerdict(props.goal.turns, v.turn) : 0;
  };
  const streakSuffix = () => {
    const s = verdictStreak(props.goal.history ?? []);
    return s.count >= 2 && s.verdict ? ` \xB7 ${s.count}\xD7 ${s.verdict.replace("_", " ")} in a row` : "";
  };
  const isTerminal = () => props.goal.status === "achieved" || props.goal.status === "impossible" || props.goal.status === "cleared" || props.goal.status === "failed";
  const capReached = () => {
    const limit = max();
    return typeof limit === "number" && Number.isFinite(limit) && done() >= limit;
  };
  const livePace = () => isTerminal() ? undefined : pace();
  const finished = () => history().length > 0 && (isTerminal() || capReached());
  const totals = () => loopTotals(history(), props.goal.setAt);
  const finalGlyph = () => props.goal.status === "achieved" ? "\u2713" : props.goal.status === "impossible" ? "\u2298" : "\u2717";
  const finalColor = () => mono() ? props.goal.status === "achieved" || props.goal.status === "impossible" ? theme().text.base : theme().text.faint : props.goal.status === "achieved" ? theme().text.feedback.info.base : props.goal.status === "impossible" ? theme().text.feedback.warning.base : theme().text.faint;
  const nowColor = () => {
    const s = props.goal.status;
    if (mono())
      return s === "paused" || s === "impossible" || s === "active" ? theme().text.base : theme().text.faint;
    if (s === "paused" || s === "impossible")
      return theme().text.feedback.warning.base;
    if (s === "active")
      return theme().text.feedback.info.base;
    return theme().text.faint;
  };
  return (() => {
    var _el$6 = _$createElement("box"), _el$7 = _$createElement("box"), _el$8 = _$createElement("text"), _el$9 = _$createElement("box"), _el$0 = _$createElement("box"), _el$1 = _$createElement("box"), _el$12 = _$createElement("box"), _el$13 = _$createElement("text"), _el$18 = _$createElement("box"), _el$19 = _$createElement("text"), _el$21 = _$createElement("text");
    _$insertNode(_el$6, _el$7);
    _$insertNode(_el$6, _el$9);
    _$insertNode(_el$6, _el$12);
    _$insertNode(_el$6, _el$18);
    _$setProp(_el$6, "flexDirection", "column");
    _$setProp(_el$6, "gap", 1);
    _$insertNode(_el$7, _el$8);
    _$setProp(_el$7, "flexDirection", "row");
    _$setProp(_el$7, "gap", 2);
    _$insert(_el$7, () => label(theme(), "loop"), _el$8);
    _$setProp(_el$8, "wrapMode", "none");
    _$insert(_el$8, () => barCaption(current(), max(), done()));
    _$insertNode(_el$9, _el$0);
    _$insertNode(_el$9, _el$1);
    _$setProp(_el$9, "flexDirection", "row");
    _$setProp(_el$9, "gap", 2);
    _$setProp(_el$0, "width", LABEL);
    _$setProp(_el$0, "flexShrink", 0);
    _$setProp(_el$1, "flexDirection", "row");
    _$setProp(_el$1, "flexShrink", 0);
    _$insert(_el$1, _$createComponent(Show, {
      get when() {
        return bar().filled > 0;
      },
      get children() {
        var _el$10 = _$createElement("text");
        _$setProp(_el$10, "wrapMode", "none");
        _$insert(_el$10, filledBarText);
        _$effect((_$p) => _$setProp(_el$10, "fg", mono() ? theme().text.base : theme().text.feedback.info.base, _$p));
        return _el$10;
      }
    }), null);
    _$insert(_el$1, _$createComponent(Show, {
      get when() {
        return BAR_CELLS - bar().filled > 0;
      },
      get children() {
        var _el$11 = _$createElement("text");
        _$setProp(_el$11, "wrapMode", "none");
        _$insert(_el$11, emptyBarText);
        _$effect((_$p) => _$setProp(_el$11, "fg", theme().text.faint, _$p));
        return _el$11;
      }
    }), null);
    _$insert(_el$6, _$createComponent(Show, {
      get when() {
        return livePace();
      },
      children: (estimate) => (() => {
        var _el$25 = _$createElement("box"), _el$26 = _$createElement("text");
        _$insertNode(_el$25, _el$26);
        _$setProp(_el$25, "flexDirection", "row");
        _$setProp(_el$25, "gap", 2);
        _$insert(_el$25, () => label(theme(), "pace"), _el$26);
        _$setProp(_el$26, "wrapMode", "none");
        _$insert(_el$26, () => `~${formatDurationCoarse(estimate().perIteration)}/iteration \xB7 ~${formatDurationCoarse(estimate().remaining)} left at this pace`);
        _$effect((_$p) => _$setProp(_el$26, "fg", theme().text.faint, _$p));
        return _el$25;
      })()
    }), _el$12);
    _$insertNode(_el$12, _el$13);
    _$setProp(_el$12, "flexDirection", "row");
    _$setProp(_el$12, "gap", 2);
    _$insert(_el$12, () => label(theme(), "objective"), _el$13);
    _$setProp(_el$13, "wrapMode", "word");
    _$setProp(_el$13, "flexGrow", 1);
    _$insert(_el$13, () => props.goal.loopObjective ?? "?");
    _$insert(_el$6, _$createComponent(Show, {
      get when() {
        return props.goal.loopCompact;
      },
      children: (compact) => {
        const c = compact();
        const pending = () => c.landedAt === undefined;
        const age = () => formatDuration(nowMs() - (c.landedAt ?? c.requestedAt));
        return (() => {
          var _el$27 = _$createElement("box"), _el$28 = _$createElement("text");
          _$insertNode(_el$27, _el$28);
          _$setProp(_el$27, "flexDirection", "row");
          _$setProp(_el$27, "gap", 2);
          _$insert(_el$27, () => label(theme(), "compact"), _el$28);
          _$setProp(_el$28, "wrapMode", "none");
          _$insert(_el$28, (() => {
            var _c$2 = _$memo(() => !!pending());
            return () => _c$2() ? `pending ${age()} \xB7 miss ${c.misses}/${COMPACT_MISS_CAP}${c.estimatedTokens !== undefined ? ` \xB7 ~${formatTokens(c.estimatedTokens)} at request` : ""}` : `landed ${age()} ago`;
          })());
          _$effect((_$p) => _$setProp(_el$28, "fg", mono() ? theme().text.base : pending() ? theme().text.feedback.warning.base : theme().text.feedback.info.base, _$p));
          return _el$27;
        })();
      }
    }), _el$18);
    _$insert(_el$6, _$createComponent(Show, {
      get when() {
        return spark();
      },
      children: (s) => (() => {
        var _el$29 = _$createElement("box"), _el$30 = _$createElement("text"), _el$31 = _$createElement("text");
        _$insertNode(_el$29, _el$30);
        _$insertNode(_el$29, _el$31);
        _$setProp(_el$29, "flexDirection", "row");
        _$setProp(_el$29, "gap", 2);
        _$insert(_el$29, () => label(theme(), "context"), _el$30);
        _$setProp(_el$30, "wrapMode", "none");
        _$setProp(_el$30, "flexShrink", 0);
        _$insert(_el$30, () => s().bars);
        _$setProp(_el$31, "wrapMode", "none");
        _$insert(_el$31, () => `~${formatTokens(s().peak)} peak \xB7 arm sizes, oldest\u2192newest`);
        _$effect((_p$) => {
          var _v$15 = theme().text.base, _v$16 = theme().text.faint;
          _v$15 !== _p$.e && (_p$.e = _$setProp(_el$30, "fg", _v$15, _p$.e));
          _v$16 !== _p$.t && (_p$.t = _$setProp(_el$31, "fg", _v$16, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$29;
      })()
    }), _el$18);
    _$insert(_el$6, _$createComponent(Show, {
      get when() {
        return done() > RAIL_VISIBLE;
      },
      get children() {
        var _el$14 = _$createElement("box"), _el$15 = _$createElement("text"), _el$17 = _$createElement("text");
        _$insertNode(_el$14, _el$15);
        _$insertNode(_el$14, _el$17);
        _$setProp(_el$14, "flexDirection", "row");
        _$setProp(_el$14, "gap", 2);
        _$setProp(_el$14, "onMouseUp", (event) => {
          if (event.button !== 0)
            return;
          event.stopPropagation();
          setShowAll((v) => !v);
        });
        _$setProp(_el$14, "onMouseOver", () => setRailHovered(true));
        _$setProp(_el$14, "onMouseOut", () => setRailHovered(false));
        _$insertNode(_el$15, _$createTextNode(`\u2026`));
        _$setProp(_el$15, "flexShrink", 0);
        _$setProp(_el$15, "width", LABEL);
        _$setProp(_el$17, "wrapMode", "none");
        _$insert(_el$17, (() => {
          var _c$ = _$memo(() => !!showAll());
          return () => _c$() ? "show recent only" : `${hiddenCount()} older iteration${hiddenCount() === 1 ? "" : "s"} \u2014 click to show`;
        })());
        _$effect((_p$) => {
          var _v$5 = theme().text.faint, _v$6 = theme().text.faint, _v$7 = railHovered() ? TextAttributes.UNDERLINE : undefined;
          _v$5 !== _p$.e && (_p$.e = _$setProp(_el$15, "fg", _v$5, _p$.e));
          _v$6 !== _p$.t && (_p$.t = _$setProp(_el$17, "fg", _v$6, _p$.t));
          _v$7 !== _p$.a && (_p$.a = _$setProp(_el$17, "attributes", _v$7, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$14;
      }
    }), _el$18);
    _$insert(_el$6, _$createComponent(For, {
      get each() {
        return visibleHistory();
      },
      children: (entry, index) => {
        const fullIndex = () => railOffset() + index();
        const zeroTools = entry.toolCalls === 0;
        const rowColor = zeroTools ? theme().text.faint : theme().text.base;
        return (() => {
          var _el$32 = _$createElement("box"), _el$33 = _$createElement("box"), _el$34 = _$createElement("text"), _el$35 = _$createElement("text");
          _$insertNode(_el$32, _el$33);
          _$setProp(_el$32, "flexDirection", "column");
          _$insertNode(_el$33, _el$34);
          _$insertNode(_el$33, _el$35);
          _$setProp(_el$33, "flexDirection", "row");
          _$setProp(_el$33, "gap", 2);
          _$insert(_el$33, () => label(theme(), `v${entry.version}`), _el$34);
          _$setProp(_el$34, "wrapMode", "none");
          _$setProp(_el$34, "flexShrink", 0);
          _$insert(_el$34, zeroTools ? "\u25CB" : "\u2713");
          _$setProp(_el$35, "wrapMode", "word");
          _$setProp(_el$35, "flexGrow", 1);
          _$setProp(_el$35, "fg", rowColor);
          _$insert(_el$35, () => `met \xB7 ${entry.turns} turn${entry.turns === 1 ? "" : "s"} \xB7 ${entry.toolCalls} tool${entry.toolCalls === 1 ? "" : "s"} \xB7 ${formatDuration(durations()[fullIndex()] ?? 0)}${zeroTools ? " \xB7 no tools \xB7 inspection only" : ""}${mixSuffix(fullIndex())}${endedSuffix(entry)}${shareSuffix(fullIndex())}`);
          _$insert(_el$32, _$createComponent(Show, {
            get when() {
              return entry.summary.trim().length > 0;
            },
            get children() {
              return _$createComponent(RailSummary, {
                get theme() {
                  return theme();
                },
                get text() {
                  return entry.summary;
                },
                get onCopy() {
                  return props.onCopySummary ? (text) => copySummary(text, entry.version) : undefined;
                },
                copied: () => copiedVersion() === entry.version
              });
            }
          }), null);
          _$effect((_$p) => _$setProp(_el$34, "fg", zeroTools ? theme().text.faint : mono() ? theme().text.base : theme().text.feedback.info.base, _$p));
          return _el$32;
        })();
      }
    }), _el$18);
    _$insertNode(_el$18, _el$19);
    _$insertNode(_el$18, _el$21);
    _$setProp(_el$18, "flexDirection", "row");
    _$setProp(_el$18, "gap", 2);
    _$insert(_el$18, () => label(theme(), "now"), _el$19);
    _$insertNode(_el$19, _$createTextNode(`\u25CE`));
    _$setProp(_el$19, "wrapMode", "none");
    _$setProp(_el$19, "flexShrink", 0);
    _$setProp(_el$21, "wrapMode", "word");
    _$setProp(_el$21, "flexGrow", 1);
    _$insert(_el$21, () => `v${current()} \xB7 ${stateWord()} \xB7 ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"}${paused() ? ` \xB7 ${pauseDiagnostics(props.goal.stall, props.goal.retries)}` : ""} \xB7 ${formatDurationCoarse(props.elapsedMs())} elapsed${streakSuffix()}`);
    _$insert(_el$18, _$createComponent(Show, {
      get when() {
        return iterVerdict();
      },
      children: (entry) => (() => {
        var _el$36 = _$createElement("box"), _el$37 = _$createElement("text"), _el$39 = _$createElement("text"), _el$40 = _$createElement("text");
        _$insertNode(_el$36, _el$37);
        _$insertNode(_el$36, _el$39);
        _$insertNode(_el$36, _el$40);
        _$setProp(_el$36, "flexDirection", "row");
        _$setProp(_el$36, "gap", 1);
        _$setProp(_el$36, "flexShrink", 0);
        _$insertNode(_el$37, _$createTextNode(`\xB7 last`));
        _$setProp(_el$37, "wrapMode", "none");
        _$setProp(_el$39, "wrapMode", "none");
        _$insert(_el$39, () => verdictGlyph(entry().verdict));
        _$setProp(_el$40, "wrapMode", "none");
        _$insert(_el$40, (() => {
          var _c$3 = _$memo(() => turnsSince() === 0);
          return () => _c$3() ? "this turn" : `${turnsSince()} turn${turnsSince() === 1 ? "" : "s"} since`;
        })());
        _$effect((_p$) => {
          var _v$17 = theme().text.muted, _v$18 = colorFor(theme(), entry().verdict, mono()), _v$19 = TextAttributes.BOLD, _v$20 = theme().text.faint;
          _v$17 !== _p$.e && (_p$.e = _$setProp(_el$37, "fg", _v$17, _p$.e));
          _v$18 !== _p$.t && (_p$.t = _$setProp(_el$39, "fg", _v$18, _p$.t));
          _v$19 !== _p$.a && (_p$.a = _$setProp(_el$39, "attributes", _v$19, _p$.a));
          _v$20 !== _p$.o && (_p$.o = _$setProp(_el$40, "fg", _v$20, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$36;
      })()
    }), null);
    _$insert(_el$6, _$createComponent(Show, {
      get when() {
        return finished();
      },
      get children() {
        var _el$22 = _$createElement("box"), _el$23 = _$createElement("text"), _el$24 = _$createElement("text");
        _$insertNode(_el$22, _el$23);
        _$insertNode(_el$22, _el$24);
        _$setProp(_el$22, "flexDirection", "row");
        _$setProp(_el$22, "gap", 2);
        _$insert(_el$22, () => label(theme(), "final"), _el$23);
        _$setProp(_el$23, "wrapMode", "none");
        _$setProp(_el$23, "flexShrink", 0);
        _$insert(_el$23, finalGlyph);
        _$setProp(_el$24, "wrapMode", "word");
        _$setProp(_el$24, "flexGrow", 1);
        _$insert(_el$24, () => `loop ${props.goal.status} \xB7 ${totals().iterations} iteration${totals().iterations === 1 ? "" : "s"} \xB7 ${totals().turns} turns \xB7 ${totals().tools} tools \xB7 ${formatDurationCoarse(totals().spanMs)} wall`);
        _$effect((_p$) => {
          var _v$8 = finalColor(), _v$9 = TextAttributes.BOLD, _v$0 = theme().text.base;
          _v$8 !== _p$.e && (_p$.e = _$setProp(_el$23, "fg", _v$8, _p$.e));
          _v$9 !== _p$.t && (_p$.t = _$setProp(_el$23, "attributes", _v$9, _p$.t));
          _v$0 !== _p$.a && (_p$.a = _$setProp(_el$24, "fg", _v$0, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$22;
      }
    }), null);
    _$insert(_el$6, _$createComponent(VerdictTrail, {
      get theme() {
        return theme();
      },
      get history() {
        return props.goal.history ?? [];
      },
      get mono() {
        return mono();
      }
    }), null);
    _$effect((_p$) => {
      var _v$1 = theme().text.base, _v$10 = TextAttributes.BOLD, _v$11 = theme().text.base, _v$12 = nowColor(), _v$13 = TextAttributes.BOLD, _v$14 = theme().text.base;
      _v$1 !== _p$.e && (_p$.e = _$setProp(_el$8, "fg", _v$1, _p$.e));
      _v$10 !== _p$.t && (_p$.t = _$setProp(_el$8, "attributes", _v$10, _p$.t));
      _v$11 !== _p$.a && (_p$.a = _$setProp(_el$13, "fg", _v$11, _p$.a));
      _v$12 !== _p$.o && (_p$.o = _$setProp(_el$19, "fg", _v$12, _p$.o));
      _v$13 !== _p$.i && (_p$.i = _$setProp(_el$19, "attributes", _v$13, _p$.i));
      _v$14 !== _p$.n && (_p$.n = _$setProp(_el$21, "fg", _v$14, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$6;
  })();
};
var VerdictTrail = (props) => {
  const mono = () => props.mono === true;
  const trail = () => trailWindow(props.history, 24);
  return _$createComponent(Show, {
    get when() {
      return trail().shown.length > 0;
    },
    get children() {
      var _el$41 = _$createElement("box"), _el$42 = _$createElement("box"), _el$43 = _$createElement("text"), _el$44 = _$createTextNode(` `), _el$45 = _$createTextNode(` of `), _el$46 = _$createTextNode(` verdict`);
      _$insertNode(_el$41, _el$42);
      _$insertNode(_el$41, _el$43);
      _$setProp(_el$41, "flexDirection", "row");
      _$setProp(_el$41, "gap", 2);
      _$insert(_el$41, () => label(props.theme, "trail"), _el$42);
      _$setProp(_el$42, "flexDirection", "row");
      _$setProp(_el$42, "flexShrink", 0);
      _$insert(_el$42, _$createComponent(For, {
        get each() {
          return trail().shown;
        },
        children: (entry) => (() => {
          var _el$47 = _$createElement("text");
          _$setProp(_el$47, "wrapMode", "none");
          _$insert(_el$47, () => verdictGlyph(entry.verdict));
          _$effect((_$p) => _$setProp(_el$47, "fg", colorFor(props.theme, entry.verdict, mono()), _$p));
          return _el$47;
        })()
      }));
      _$insertNode(_el$43, _el$44);
      _$insertNode(_el$43, _el$45);
      _$insertNode(_el$43, _el$46);
      _$setProp(_el$43, "wrapMode", "none");
      _$setProp(_el$43, "flexShrink", 0);
      _$insert(_el$43, () => trail().shown.length, _el$45);
      _$insert(_el$43, () => trail().total, _el$46);
      _$insert(_el$43, () => trail().total === 1 ? "" : "s", null);
      _$effect((_$p) => _$setProp(_el$43, "fg", props.theme.text.muted, _$p));
      return _el$41;
    }
  });
};
var HistoryBlock = (props) => {
  const theme = () => props.theme;
  const mono = () => props.mono === true;
  const history = () => props.goal.history ?? [];
  const counts = () => verdictCounts(history());
  const last = () => lastVerdict(history());
  const streak = () => verdictStreak(history());
  const streakSuffix = () => {
    const s = streak();
    return s.count >= 2 && s.verdict ? ` \xB7 ${s.count}\xD7 ${s.verdict.replace("_", " ")} in a row` : "";
  };
  const elapsed = () => formatDurationCoarse(props.elapsedMs());
  const countsText = () => {
    const c = counts();
    const parts = [`${c.met} met`, `${c.not_met} not_met`];
    if (c.impossible > 0)
      parts.push(`${c.impossible} impossible`);
    return parts.join(" \xB7 ");
  };
  return (() => {
    var _el$48 = _$createElement("box"), _el$49 = _$createElement("box");
    _$insertNode(_el$48, _el$49);
    _$setProp(_el$48, "flexDirection", "column");
    _$setProp(_el$48, "gap", 1);
    _$setProp(_el$49, "flexDirection", "row");
    _$setProp(_el$49, "gap", 2);
    _$insert(_el$49, () => label(theme(), "history"), null);
    _$insert(_el$49, _$createComponent(Show, {
      get when() {
        return last();
      },
      get fallback() {
        return (() => {
          var _el$50 = _$createElement("text"), _el$51 = _$createTextNode(`no verdicts yet \xB7 `), _el$52 = _$createTextNode(` elapsed`);
          _$insertNode(_el$50, _el$51);
          _$insertNode(_el$50, _el$52);
          _$setProp(_el$50, "wrapMode", "none");
          _$insert(_el$50, elapsed, _el$52);
          _$effect((_$p) => _$setProp(_el$50, "fg", theme().text.faint, _$p));
          return _el$50;
        })();
      },
      children: (entry) => (() => {
        var _el$53 = _$createElement("box"), _el$54 = _$createElement("text"), _el$55 = _$createElement("text");
        _$insertNode(_el$53, _el$54);
        _$insertNode(_el$53, _el$55);
        _$setProp(_el$53, "flexDirection", "row");
        _$setProp(_el$53, "gap", 2);
        _$setProp(_el$53, "flexGrow", 1);
        _$setProp(_el$54, "wrapMode", "none");
        _$setProp(_el$54, "flexShrink", 0);
        _$insert(_el$54, () => verdictGlyph(entry().verdict));
        _$setProp(_el$55, "wrapMode", "word");
        _$setProp(_el$55, "flexGrow", 1);
        _$insert(_el$55, () => `last ${entry().verdict.replace("_", " ")} (turn ${entry().turn}) \xB7 ${props.goal.turns} turn${props.goal.turns === 1 ? "" : "s"} \xB7 ${countsText()} \xB7 ${elapsed()} elapsed${streakSuffix()}`);
        _$effect((_p$) => {
          var _v$21 = colorFor(theme(), entry().verdict, mono()), _v$22 = TextAttributes.BOLD, _v$23 = theme().text.base;
          _v$21 !== _p$.e && (_p$.e = _$setProp(_el$54, "fg", _v$21, _p$.e));
          _v$22 !== _p$.t && (_p$.t = _$setProp(_el$54, "attributes", _v$22, _p$.t));
          _v$23 !== _p$.a && (_p$.a = _$setProp(_el$55, "fg", _v$23, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$53;
      })()
    }), null);
    _$insert(_el$48, _$createComponent(VerdictTrail, {
      get theme() {
        return theme();
      },
      get history() {
        return history();
      },
      get mono() {
        return mono();
      }
    }), null);
    return _el$48;
  })();
};

// src/status-dialog.tsx
var StatusDialogBody = (props) => {
  const theme = () => props.theme;
  const ascii = motionDisabled(process.env);
  const mono = () => props.mono === true;
  const label = (text) => (() => {
    var _el$ = _$createElement2("text");
    _$setProp2(_el$, "flexShrink", 0);
    _$setProp2(_el$, "width", LABEL);
    _$insert2(_el$, text);
    _$effect2((_$p) => _$setProp2(_el$, "fg", theme().text.faint, _$p));
    return _el$;
  })();
  const field = (name, children, wide = false) => (() => {
    var _el$2 = _$createElement2("box"), _el$3 = _$createElement2("text");
    _$insertNode2(_el$2, _el$3);
    _$setProp2(_el$2, "flexDirection", "row");
    _$setProp2(_el$2, "gap", 2);
    _$insert2(_el$2, () => label(name), _el$3);
    _$setProp2(_el$3, "wrapMode", "word");
    _$setProp2(_el$3, "flexGrow", wide ? 1 : 0);
    _$insert2(_el$3, children);
    _$effect2((_$p) => _$setProp2(_el$3, "fg", theme().text.base, _$p));
    return _el$2;
  })();
  const stateColor = () => props.goal?.status ? stateAccentColor(theme(), props.goal.status, false, mono()) : theme().text.muted;
  const g = () => props.goal;
  const remediation = () => {
    const goal = g();
    return goal ? remediationFor(goal) : undefined;
  };
  const hint = () => {
    const goal = g();
    return goal ? evaluatorHint(goal) : null;
  };
  const [copied, setCopied] = createSignal2(null);
  let copiedTimer;
  const acknowledge = (key) => {
    setCopied(key);
    if (copiedTimer)
      clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(null), 1600);
  };
  onCleanup2(() => {
    if (copiedTimer)
      clearTimeout(copiedTimer);
  });
  const copiedSuffix = (key) => copied() === key ? " \u2713 copied" : "";
  const [reasonHovered, setReasonHovered] = createSignal2(false);
  const [conditionHovered, setConditionHovered] = createSignal2(false);
  const copyCondition = (condition) => {
    try {
      props.onCopyCondition?.(condition);
      acknowledge("condition");
    } catch {}
  };
  const copyReason = (reason) => {
    if (!props.onCopyReason)
      return;
    try {
      props.onCopyReason(reason);
      acknowledge("reason");
    } catch {}
  };
  return _$createComponent2(Show2, {
    get when() {
      return g();
    },
    get fallback() {
      return (() => {
        var _el$4 = _$createElement2("text");
        _$setProp2(_el$4, "wrapMode", "word");
        _$insert2(_el$4, () => props.fallback);
        _$effect2((_$p) => _$setProp2(_el$4, "fg", theme().text.base, _$p));
        return _el$4;
      })();
    },
    children: (goal) => (() => {
      var _el$5 = _$createElement2("box"), _el$6 = _$createElement2("box"), _el$7 = _$createElement2("text"), _el$8 = _$createElement2("text"), _el$9 = _$createTextNode2(` \xB7 `), _el$0 = _$createTextNode2(` turn`), _el$1 = _$createElement2("box"), _el$10 = _$createElement2("text");
      _$insertNode2(_el$5, _el$6);
      _$insertNode2(_el$5, _el$1);
      _$setProp2(_el$5, "flexDirection", "column");
      _$setProp2(_el$5, "gap", 1);
      _$setProp2(_el$5, "paddingRight", 3);
      _$insertNode2(_el$6, _el$7);
      _$insertNode2(_el$6, _el$8);
      _$setProp2(_el$6, "flexDirection", "row");
      _$setProp2(_el$6, "gap", 2);
      _$insert2(_el$7, () => goal().status);
      _$insertNode2(_el$8, _el$9);
      _$insertNode2(_el$8, _el$0);
      _$insert2(_el$8, () => formatDurationCoarse(props.elapsedMs()), _el$9);
      _$insert2(_el$8, () => goal().turns, _el$0);
      _$insert2(_el$8, () => goal().turns === 1 ? "" : "s", null);
      _$insert2(_el$8, (() => {
        var _c$ = _$memo2(() => !!goal().evaluating);
        return () => _c$() ? " \xB7 checking" : goal().waiting ? " \xB7 waiting" : "";
      })(), null);
      _$insertNode2(_el$1, _el$10);
      _$setProp2(_el$1, "flexDirection", "row");
      _$setProp2(_el$1, "gap", 2);
      _$setProp2(_el$1, "onMouseUp", (event) => {
        if (event.button !== 0)
          return;
        event.stopPropagation();
        copyCondition(goal().condition);
      });
      _$setProp2(_el$1, "onMouseOver", () => setConditionHovered(true));
      _$setProp2(_el$1, "onMouseOut", () => setConditionHovered(false));
      _$insert2(_el$1, () => label("goal"), _el$10);
      _$setProp2(_el$10, "wrapMode", "word");
      _$setProp2(_el$10, "flexGrow", 1);
      _$insert2(_el$10, () => goal().condition, null);
      _$insert2(_el$10, () => copiedSuffix("condition"), null);
      _$insert2(_el$1, _$createComponent2(Show2, {
        get when() {
          return conditionHovered();
        },
        get children() {
          var _el$11 = _$createElement2("text");
          _$insertNode2(_el$11, _$createTextNode2(`copy`));
          _$setProp2(_el$11, "wrapMode", "none");
          _$setProp2(_el$11, "flexShrink", 0);
          _$effect2((_$p) => _$setProp2(_el$11, "fg", theme().text.faint, _$p));
          return _el$11;
        }
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return goal().reason;
        },
        children: (reason) => _$createComponent2(Show2, {
          get when() {
            return props.onCopyReason;
          },
          get fallback() {
            return field(goal().status === "active" ? "evaluator" : "reason", reason(), true);
          },
          get children() {
            var _el$13 = _$createElement2("box"), _el$14 = _$createElement2("text");
            _$insertNode2(_el$13, _el$14);
            _$setProp2(_el$13, "flexDirection", "row");
            _$setProp2(_el$13, "gap", 2);
            _$setProp2(_el$13, "onMouseUp", (event) => {
              if (event.button !== 0)
                return;
              event.stopPropagation();
              copyReason(reason());
            });
            _$setProp2(_el$13, "onMouseOver", () => setReasonHovered(true));
            _$setProp2(_el$13, "onMouseOut", () => setReasonHovered(false));
            _$insert2(_el$13, () => label(goal().status === "active" ? "evaluator" : "reason"), _el$14);
            _$setProp2(_el$14, "wrapMode", "word");
            _$setProp2(_el$14, "flexGrow", 1);
            _$insert2(_el$14, reason, null);
            _$insert2(_el$14, () => copiedSuffix("reason"), null);
            _$insert2(_el$13, _$createComponent2(Show2, {
              get when() {
                return reasonHovered();
              },
              get children() {
                var _el$15 = _$createElement2("text");
                _$insertNode2(_el$15, _$createTextNode2(`copy`));
                _$setProp2(_el$15, "wrapMode", "none");
                _$setProp2(_el$15, "flexShrink", 0);
                _$effect2((_$p) => _$setProp2(_el$15, "fg", theme().text.faint, _$p));
                return _el$15;
              }
            }), null);
            _$effect2((_p$) => {
              var _v$6 = theme().text.base, _v$7 = reasonHovered() ? TextAttributes2.UNDERLINE : undefined;
              _v$6 !== _p$.e && (_p$.e = _$setProp2(_el$14, "fg", _v$6, _p$.e));
              _v$7 !== _p$.t && (_p$.t = _$setProp2(_el$14, "attributes", _v$7, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$13;
          }
        })
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return hint();
        },
        children: (h) => (() => {
          var _el$17 = _$createElement2("box"), _el$18 = _$createElement2("text");
          _$insertNode2(_el$17, _el$18);
          _$setProp2(_el$17, "flexDirection", "row");
          _$setProp2(_el$17, "gap", 2);
          _$insert2(_el$17, () => label("hint"), _el$18);
          _$setProp2(_el$18, "wrapMode", "word");
          _$setProp2(_el$18, "flexGrow", 1);
          _$insert2(_el$18, () => h().full);
          _$effect2((_$p) => _$setProp2(_el$18, "fg", theme().text.muted, _$p));
          return _el$17;
        })()
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return remediation();
        },
        children: (fix) => (() => {
          var _el$19 = _$createElement2("box"), _el$20 = _$createElement2("text");
          _$insertNode2(_el$19, _el$20);
          _$setProp2(_el$19, "flexDirection", "row");
          _$setProp2(_el$19, "gap", 2);
          _$insert2(_el$19, () => label("fix"), _el$20);
          _$setProp2(_el$20, "wrapMode", "word");
          _$setProp2(_el$20, "flexGrow", 1);
          _$insert2(_el$20, () => fix().text);
          _$effect2((_$p) => _$setProp2(_el$20, "fg", fixAccentColor(theme(), fix().tone === "error" ? "error" : "warning", mono()), _$p));
          return _el$19;
        })()
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return goal().spend;
        },
        children: (spend) => field("spend", formatSpend(spend()))
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return goal().contextSize !== undefined;
        },
        get children() {
          return (() => {
            const meter = () => contextMeter(goal().contextSize, goal().compactAtTokens, CONTEXT_BAR_CELLS, ascii);
            const hot = () => meter().hot;
            const fg = () => mono() ? theme().text.base : hot() ? theme().text.feedback.warning.base : theme().text.feedback.info.base;
            return (() => {
              var _el$21 = _$createElement2("box");
              _$setProp2(_el$21, "flexDirection", "row");
              _$setProp2(_el$21, "gap", 2);
              _$insert2(_el$21, () => label("context"), null);
              _$insert2(_el$21, _$createComponent2(Show2, {
                get when() {
                  return goal().compactAtTokens !== undefined;
                },
                get fallback() {
                  return (() => {
                    var _el$24 = _$createElement2("text");
                    _$setProp2(_el$24, "wrapMode", "none");
                    _$insert2(_el$24, () => `~${formatTokens(goal().contextSize)} tokens`);
                    _$effect2((_$p) => _$setProp2(_el$24, "fg", theme().text.muted, _$p));
                    return _el$24;
                  })();
                },
                get children() {
                  return [(() => {
                    var _el$22 = _$createElement2("text");
                    _$setProp2(_el$22, "wrapMode", "none");
                    _$insert2(_el$22, () => meter().text);
                    _$effect2((_$p) => _$setProp2(_el$22, "fg", fg(), _$p));
                    return _el$22;
                  })(), (() => {
                    var _el$23 = _$createElement2("text");
                    _$setProp2(_el$23, "wrapMode", "none");
                    _$insert2(_el$23, () => `~${formatTokens(goal().contextSize)} of ${formatTokens(goal().compactAtTokens)} \xB7 ${meter().pct}%`);
                    _$effect2((_$p) => _$setProp2(_el$23, "fg", mono() ? theme().text.muted : hot() ? theme().text.feedback.warning.base : theme().text.muted, _$p));
                    return _el$23;
                  })()];
                }
              }), null);
              return _el$21;
            })();
          })();
        }
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return goal().loopEnabled;
        },
        get children() {
          return _$createComponent2(LoopSection, {
            get goal() {
              return goal();
            },
            get theme() {
              return theme();
            },
            get elapsedMs() {
              return props.elapsedMs;
            },
            get nowMs() {
              return props.nowMs;
            },
            get mono() {
              return mono();
            },
            get onCopySummary() {
              return props.onCopySummary;
            }
          });
        }
      }), null);
      _$insert2(_el$5, _$createComponent2(Show2, {
        get when() {
          return !goal().loopEnabled;
        },
        get children() {
          return _$createComponent2(HistoryBlock, {
            get goal() {
              return goal();
            },
            get theme() {
              return theme();
            },
            get elapsedMs() {
              return props.elapsedMs;
            },
            get mono() {
              return mono();
            }
          });
        }
      }), null);
      _$effect2((_p$) => {
        var _v$ = stateColor(), _v$2 = TextAttributes2.BOLD, _v$3 = theme().text.muted, _v$4 = theme().text.base, _v$5 = conditionHovered() ? TextAttributes2.UNDERLINE : undefined;
        _v$ !== _p$.e && (_p$.e = _$setProp2(_el$7, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp2(_el$7, "attributes", _v$2, _p$.t));
        _v$3 !== _p$.a && (_p$.a = _$setProp2(_el$8, "fg", _v$3, _p$.a));
        _v$4 !== _p$.o && (_p$.o = _$setProp2(_el$10, "fg", _v$4, _p$.o));
        _v$5 !== _p$.i && (_p$.i = _$setProp2(_el$10, "attributes", _v$5, _p$.i));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined,
        i: undefined
      });
      return _el$5;
    })()
  });
};

// src/hud-card.tsx
import { createTextNode as _$createTextNode3 } from "@opentui/solid";
import { insertNode as _$insertNode3 } from "@opentui/solid";
import { createComponent as _$createComponent3 } from "@opentui/solid";
import { memo as _$memo3 } from "@opentui/solid";
import { effect as _$effect3 } from "@opentui/solid";
import { insert as _$insert3 } from "@opentui/solid";
import { setProp as _$setProp3 } from "@opentui/solid";
import { createElement as _$createElement3 } from "@opentui/solid";
import { TextAttributes as TextAttributes3 } from "@opentui/core";
import { createSignal as createSignal3, Show as Show3 } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
var CONDITION_MAX = 42;
var stateWord2 = (goal) => goal.status === "paused" ? "paused" : goal.status === "active" ? goal.evaluating ? "checking" : goal.waiting ? "waiting" : isRetryStuck(goal) ? "stuck" : "active" : goal.status;
var verdictColor = (theme, verdict, mono) => verdictAccentColor(theme, verdict, mono);
var Hint = (props) => (() => {
  var _el$ = _$createElement3("text");
  _$setProp3(_el$, "wrapMode", "none");
  _$insert3(_el$, () => props.text);
  _$effect3((_$p) => _$setProp3(_el$, "fg", props.theme.text.faint, _$p));
  return _el$;
})();
var CONTEXT_MENU_ROWS = 4;
var REMEDIATION_WIDTH = 49;
var cardRowPlan = (goal, contextOpen = false, maxRows = Number.POSITIVE_INFINITY) => {
  const remediation = remediationFor(goal);
  const remediationRows = remediation ? wrapLines(remediation.text, REMEDIATION_WIDTH) : 0;
  const hintAvailable = Boolean(evaluatorHint(goal));
  const spendAvailable = Boolean(goal.spend);
  const lastAvailable = Boolean(lastVerdict(goal.history ?? []));
  const menu = contextOpen ? CONTEXT_MENU_ROWS : 0;
  const fit = (hint, spend, last) => 5 + (spend && spendAvailable ? 1 : 0) + (last && lastAvailable ? 1 : 0) + remediationRows + (hint && hintAvailable ? 1 : 0) + menu;
  let hint = hintAvailable, spend = spendAvailable, last = lastAvailable;
  let rows = fit(hint, spend, last);
  if (rows <= maxRows)
    return {
      rows,
      hint,
      spend,
      last
    };
  hint = false;
  rows = fit(hint, spend, last);
  if (rows <= maxRows)
    return {
      rows,
      hint,
      spend,
      last
    };
  spend = false;
  rows = fit(hint, spend, last);
  if (rows <= maxRows)
    return {
      rows,
      hint,
      spend,
      last
    };
  last = false;
  rows = fit(hint, spend, last);
  return {
    rows,
    hint,
    spend,
    last
  };
};
var hudCardRows = (goal, contextOpen = false, maxRows = Number.POSITIVE_INFINITY) => cardRowPlan(goal, contextOpen, maxRows).rows;
var pinBudget = (terminalWidth, pillTextLength) => Math.floor(terminalWidth) - Math.floor(pillTextLength) - PIN_PREFIX.length - 1;
var DIALOG_FOOTER_FULL_HINT = "up/down scroll \xB7 pgup/pgdn \xB7 home/end \xB7 p pin \xB7 c copy";
var DIALOG_FOOTER_SHORT_HINT = "up/down scroll \xB7 p pin \xB7 c copy";
var footerCopyLabel = (copied, roomy) => copied ? "\u2713 copied" : roomy ? "copy condition" : "copy";
var footerPinLabel = (pinned, roomy) => pinned ? roomy ? "unpin condition" : "unpin" : roomy ? "pin condition" : "pin";
var DialogFooter = (props) => {
  const dimensions = useTerminalDimensions();
  const wide = () => dimensions().width >= 140;
  const roomy = () => dimensions().width >= 96;
  return (() => {
    var _el$2 = _$createElement3("box"), _el$3 = _$createElement3("text"), _el$4 = _$createElement3("box");
    _$insertNode3(_el$2, _el$3);
    _$insertNode3(_el$2, _el$4);
    _$setProp3(_el$2, "flexDirection", "row");
    _$setProp3(_el$2, "gap", 1);
    _$setProp3(_el$3, "wrapMode", "none");
    _$insert3(_el$3, () => wide() ? DIALOG_FOOTER_FULL_HINT : DIALOG_FOOTER_SHORT_HINT);
    _$setProp3(_el$4, "flexGrow", 1);
    _$insert3(_el$2, _$createComponent3(HudButton, {
      get theme() {
        return props.theme;
      },
      get label() {
        return footerCopyLabel(props.copied(), roomy());
      },
      get mono() {
        return props.mono;
      },
      get onPress() {
        return props.onCopy;
      }
    }), null);
    _$insert3(_el$2, _$createComponent3(HudButton, {
      get theme() {
        return props.theme;
      },
      get label() {
        return footerPinLabel(props.pinned(), roomy());
      },
      get mono() {
        return props.mono;
      },
      get onPress() {
        return props.onTogglePin;
      }
    }), null);
    _$insert3(_el$2, _$createComponent3(HudButton, {
      get theme() {
        return props.theme;
      },
      get label() {
        return roomy() ? "clear goal" : "clear";
      },
      get mono() {
        return props.mono;
      },
      get onPress() {
        return props.onClear;
      }
    }), null);
    _$effect3((_$p) => _$setProp3(_el$3, "fg", props.theme.text.faint, _$p));
    return _el$2;
  })();
};
var HudButton = (props) => {
  const [hovered, setHovered] = createSignal3(false);
  const mono = () => props.mono === true;
  return (() => {
    var _el$5 = _$createElement3("box"), _el$6 = _$createElement3("text");
    _$insertNode3(_el$5, _el$6);
    _$setProp3(_el$5, "flexDirection", "row");
    _$setProp3(_el$5, "flexShrink", 0);
    _$setProp3(_el$5, "height", 1);
    _$setProp3(_el$5, "paddingLeft", 1);
    _$setProp3(_el$5, "paddingRight", 1);
    _$setProp3(_el$5, "onMouseOver", () => setHovered(true));
    _$setProp3(_el$5, "onMouseOut", () => setHovered(false));
    _$setProp3(_el$5, "onMouseUp", (event) => {
      if (event.button !== 0)
        return;
      event.stopPropagation();
      try {
        props.onPress();
      } catch {}
    });
    _$setProp3(_el$6, "wrapMode", "none");
    _$insert3(_el$6, () => `[${props.label}]`);
    _$effect3((_p$) => {
      var _v$ = !mono() && hovered() ? props.theme.background?.raised?.high : undefined, _v$2 = hovered() ? props.theme.text.base : props.theme.text.muted, _v$3 = mono() && hovered() ? TextAttributes3.UNDERLINE : undefined;
      _v$ !== _p$.e && (_p$.e = _$setProp3(_el$5, "backgroundColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp3(_el$6, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp3(_el$6, "attributes", _v$3, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$5;
  })();
};
var HudMenuRow = (props) => {
  const [hovered, setHovered] = createSignal3(false);
  const mono = () => props.mono === true;
  const enabled = () => props.enabled !== false;
  const active = () => enabled() && hovered();
  const fg = () => !enabled() ? props.theme.text.faint : props.danger ? props.theme.text.feedback.warning.base : active() ? props.theme.text.base : props.theme.text.muted;
  return (() => {
    var _el$7 = _$createElement3("box"), _el$8 = _$createElement3("text"), _el$9 = _$createElement3("text");
    _$insertNode3(_el$7, _el$8);
    _$insertNode3(_el$7, _el$9);
    _$setProp3(_el$7, "flexDirection", "row");
    _$setProp3(_el$7, "gap", 1);
    _$setProp3(_el$7, "height", 1);
    _$setProp3(_el$7, "onMouseOver", () => enabled() && setHovered(true));
    _$setProp3(_el$7, "onMouseOut", () => setHovered(false));
    _$setProp3(_el$7, "onMouseUp", (event) => {
      if (event.button !== 0)
        return;
      if (!enabled())
        return;
      event.stopPropagation();
      try {
        props.onPress();
      } catch {}
    });
    _$setProp3(_el$8, "wrapMode", "none");
    _$setProp3(_el$8, "flexShrink", 0);
    _$setProp3(_el$8, "width", LABEL);
    _$insert3(_el$8, () => props.gutter);
    _$setProp3(_el$9, "wrapMode", "none");
    _$insert3(_el$9, () => props.text);
    _$effect3((_p$) => {
      var _v$4 = !mono() && active() ? props.theme.background?.raised?.high : undefined, _v$5 = props.theme.text.faint, _v$6 = fg(), _v$7 = mono() && active() ? TextAttributes3.UNDERLINE : undefined;
      _v$4 !== _p$.e && (_p$.e = _$setProp3(_el$7, "backgroundColor", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp3(_el$8, "fg", _v$5, _p$.t));
      _v$6 !== _p$.a && (_p$.a = _$setProp3(_el$9, "fg", _v$6, _p$.a));
      _v$7 !== _p$.o && (_p$.o = _$setProp3(_el$9, "attributes", _v$7, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$7;
  })();
};
var HudCard = (props) => {
  const theme = () => props.theme;
  const mono = () => props.mono === true;
  const g = () => props.goal;
  const [conditionHovered, setConditionHovered] = createSignal3(false);
  const looped = () => Boolean(g().loopEnabled);
  const cap = () => {
    const max = g().loopMaxLoops;
    return typeof max === "number" && max > 0 ? `/${max}` : "";
  };
  const iteration = () => Math.max(1, g().loopIteration ?? (g().loopHistory?.length ?? 0) + 1);
  const pips = () => looped() ? renderPips(g().loopHistory?.length ?? 0, g().loopMaxLoops, mono()) : "";
  const title = () => looped() ? `${GOAL_GLYPH} /goal-loop \xB7 v${iteration()}${cap()}` : `${GOAL_GLYPH} /goal`;
  const borderColor = () => borderAccentColor(theme(), g().status, {
    hot: isCompactHot(g()),
    stuck: isRetryStuck(g())
  }, mono());
  const turns = () => g().turns;
  const stateColor = () => stateAccentColor(theme(), g().status, isRetryStuck(g()), mono());
  const last = () => lastVerdict(g().history ?? []);
  const turnsSince = () => {
    const entry = last();
    return entry ? turnsSinceVerdict(turns(), entry.turn) : 0;
  };
  const plan = () => cardRowPlan(g(), props.contextOpen === true, props.maxRows ?? Number.POSITIVE_INFINITY);
  const remediation = () => remediationFor(g());
  const hint = () => plan().hint ? evaluatorHint(g()) : undefined;
  const latestSummary = () => g().loopHistory?.at(-1)?.summary;
  const copyCondition = () => {
    try {
      props.onCopyCondition(g().condition);
    } catch {}
  };
  const menuAction = (run) => () => {
    run();
    try {
      props.onCloseMenu?.();
    } catch {}
  };
  return (() => {
    var _el$0 = _$createElement3("box"), _el$1 = _$createElement3("box"), _el$10 = _$createElement3("text"), _el$12 = _$createElement3("text"), _el$13 = _$createElement3("box"), _el$14 = _$createElement3("text"), _el$16 = _$createElement3("text"), _el$17 = _$createElement3("text"), _el$18 = _$createElement3("box"), _el$19 = _$createElement3("box");
    _$insertNode3(_el$0, _el$1);
    _$insertNode3(_el$0, _el$13);
    _$insertNode3(_el$0, _el$18);
    _$setProp3(_el$0, "flexDirection", "column");
    _$setProp3(_el$0, "flexShrink", 0);
    _$setProp3(_el$0, "border", true);
    _$setProp3(_el$0, "borderStyle", "single");
    _$setProp3(_el$0, "bottomTitle", " esc dismiss ");
    _$setProp3(_el$0, "bottomTitleAlignment", "right");
    _$setProp3(_el$0, "titleAlignment", "left");
    _$setProp3(_el$0, "paddingLeft", 1);
    _$setProp3(_el$0, "paddingRight", 1);
    _$setProp3(_el$0, "onMouseUp", (event) => {
      if (event.button === 2) {
        try {
          props.onToggleContext?.();
        } catch {}
      }
    });
    _$insertNode3(_el$1, _el$10);
    _$insertNode3(_el$1, _el$12);
    _$setProp3(_el$1, "flexDirection", "row");
    _$setProp3(_el$1, "gap", 1);
    _$setProp3(_el$1, "onMouseUp", (event) => {
      if (event.button !== 0)
        return;
      event.stopPropagation();
      copyCondition();
    });
    _$setProp3(_el$1, "onMouseOver", () => setConditionHovered(true));
    _$setProp3(_el$1, "onMouseOut", () => setConditionHovered(false));
    _$insertNode3(_el$10, _$createTextNode3(`condition`));
    _$setProp3(_el$10, "wrapMode", "none");
    _$setProp3(_el$10, "flexShrink", 0);
    _$setProp3(_el$10, "width", LABEL);
    _$setProp3(_el$12, "wrapMode", "none");
    _$setProp3(_el$12, "flexGrow", 1);
    _$insert3(_el$12, () => truncate(g().condition, CONDITION_MAX));
    _$insert3(_el$1, _$createComponent3(Show3, {
      get when() {
        return conditionHovered();
      },
      get children() {
        return _$createComponent3(Hint, {
          get theme() {
            return theme();
          },
          text: "copy"
        });
      }
    }), null);
    _$insertNode3(_el$13, _el$14);
    _$insertNode3(_el$13, _el$16);
    _$insertNode3(_el$13, _el$17);
    _$setProp3(_el$13, "flexDirection", "row");
    _$setProp3(_el$13, "gap", 1);
    _$insertNode3(_el$14, _$createTextNode3(`now`));
    _$setProp3(_el$14, "wrapMode", "none");
    _$setProp3(_el$14, "flexShrink", 0);
    _$setProp3(_el$14, "width", LABEL);
    _$setProp3(_el$16, "wrapMode", "none");
    _$insert3(_el$16, () => stateWord2(g()));
    _$setProp3(_el$17, "wrapMode", "none");
    _$insert3(_el$17, () => `${looped() ? `v${iteration()}${cap()}${pips() ? ` ${pips()}` : ""} \xB7 ` : ""}${turns()} turn${turns() === 1 ? "" : "s"} \xB7 ${formatDurationCoarse(props.elapsedMs())}`);
    _$insert3(_el$0, _$createComponent3(Show3, {
      get when() {
        return _$memo3(() => !!plan().spend)() ? g().spend : undefined;
      },
      children: (spend) => (() => {
        var _el$21 = _$createElement3("box"), _el$22 = _$createElement3("text"), _el$24 = _$createElement3("text");
        _$insertNode3(_el$21, _el$22);
        _$insertNode3(_el$21, _el$24);
        _$setProp3(_el$21, "flexDirection", "row");
        _$setProp3(_el$21, "gap", 1);
        _$insertNode3(_el$22, _$createTextNode3(`spend`));
        _$setProp3(_el$22, "wrapMode", "none");
        _$setProp3(_el$22, "flexShrink", 0);
        _$setProp3(_el$22, "width", LABEL);
        _$setProp3(_el$24, "wrapMode", "none");
        _$insert3(_el$24, () => formatSpend(spend()));
        _$effect3((_p$) => {
          var _v$18 = theme().text.faint, _v$19 = theme().text.muted;
          _v$18 !== _p$.e && (_p$.e = _$setProp3(_el$22, "fg", _v$18, _p$.e));
          _v$19 !== _p$.t && (_p$.t = _$setProp3(_el$24, "fg", _v$19, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$21;
      })()
    }), _el$18);
    _$insert3(_el$0, _$createComponent3(Show3, {
      get when() {
        return hint();
      },
      children: (h) => (() => {
        var _el$25 = _$createElement3("box"), _el$26 = _$createElement3("text"), _el$28 = _$createElement3("text");
        _$insertNode3(_el$25, _el$26);
        _$insertNode3(_el$25, _el$28);
        _$setProp3(_el$25, "flexDirection", "row");
        _$setProp3(_el$25, "gap", 1);
        _$insertNode3(_el$26, _$createTextNode3(`hint`));
        _$setProp3(_el$26, "wrapMode", "none");
        _$setProp3(_el$26, "flexShrink", 0);
        _$setProp3(_el$26, "width", LABEL);
        _$setProp3(_el$28, "wrapMode", "none");
        _$setProp3(_el$28, "flexGrow", 1);
        _$insert3(_el$28, () => h().card);
        _$effect3((_p$) => {
          var _v$20 = theme().text.faint, _v$21 = theme().text.muted;
          _v$20 !== _p$.e && (_p$.e = _$setProp3(_el$26, "fg", _v$20, _p$.e));
          _v$21 !== _p$.t && (_p$.t = _$setProp3(_el$28, "fg", _v$21, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$25;
      })()
    }), _el$18);
    _$insert3(_el$0, _$createComponent3(Show3, {
      get when() {
        return _$memo3(() => !!plan().last)() && last();
      },
      children: (entry) => (() => {
        var _el$29 = _$createElement3("box"), _el$30 = _$createElement3("text"), _el$32 = _$createElement3("text"), _el$33 = _$createElement3("text");
        _$insertNode3(_el$29, _el$30);
        _$insertNode3(_el$29, _el$32);
        _$insertNode3(_el$29, _el$33);
        _$setProp3(_el$29, "flexDirection", "row");
        _$setProp3(_el$29, "gap", 1);
        _$insertNode3(_el$30, _$createTextNode3(`last`));
        _$setProp3(_el$30, "wrapMode", "none");
        _$setProp3(_el$30, "flexShrink", 0);
        _$setProp3(_el$30, "width", LABEL);
        _$setProp3(_el$32, "wrapMode", "none");
        _$setProp3(_el$32, "flexShrink", 0);
        _$insert3(_el$32, () => verdictGlyph(entry().verdict));
        _$setProp3(_el$33, "wrapMode", "none");
        _$insert3(_el$33, () => `${entry().verdict.replace("_", " ")}${turnsSince() === 0 ? " \xB7 this turn" : ` \xB7 ${turnsSince()} turn${turnsSince() === 1 ? "" : "s"} since`}`);
        _$effect3((_p$) => {
          var _v$22 = theme().text.faint, _v$23 = verdictColor(theme(), entry().verdict, mono()), _v$24 = TextAttributes3.BOLD, _v$25 = theme().text.muted;
          _v$22 !== _p$.e && (_p$.e = _$setProp3(_el$30, "fg", _v$22, _p$.e));
          _v$23 !== _p$.t && (_p$.t = _$setProp3(_el$32, "fg", _v$23, _p$.t));
          _v$24 !== _p$.a && (_p$.a = _$setProp3(_el$32, "attributes", _v$24, _p$.a));
          _v$25 !== _p$.o && (_p$.o = _$setProp3(_el$33, "fg", _v$25, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$29;
      })()
    }), _el$18);
    _$insert3(_el$0, _$createComponent3(Show3, {
      get when() {
        return remediation();
      },
      children: (fix) => (() => {
        var _el$34 = _$createElement3("box"), _el$35 = _$createElement3("text"), _el$37 = _$createElement3("text");
        _$insertNode3(_el$34, _el$35);
        _$insertNode3(_el$34, _el$37);
        _$setProp3(_el$34, "flexDirection", "row");
        _$setProp3(_el$34, "gap", 1);
        _$insertNode3(_el$35, _$createTextNode3(`fix`));
        _$setProp3(_el$35, "wrapMode", "none");
        _$setProp3(_el$35, "flexShrink", 0);
        _$setProp3(_el$35, "width", LABEL);
        _$setProp3(_el$37, "wrapMode", "word");
        _$setProp3(_el$37, "flexGrow", 1);
        _$insert3(_el$37, () => fix().text);
        _$effect3((_p$) => {
          var _v$26 = fixAccentColor(theme(), fix().tone === "error" ? "error" : "warning", mono()), _v$27 = fixAccentColor(theme(), fix().tone === "error" ? "error" : "warning", mono());
          _v$26 !== _p$.e && (_p$.e = _$setProp3(_el$35, "fg", _v$26, _p$.e));
          _v$27 !== _p$.t && (_p$.t = _$setProp3(_el$37, "fg", _v$27, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$34;
      })()
    }), _el$18);
    _$insertNode3(_el$18, _el$19);
    _$setProp3(_el$18, "flexDirection", "row");
    _$setProp3(_el$18, "gap", 1);
    _$setProp3(_el$18, "marginTop", 0);
    _$insert3(_el$18, _$createComponent3(HudButton, {
      get theme() {
        return theme();
      },
      label: "details",
      get mono() {
        return mono();
      },
      get onPress() {
        return props.onDetails;
      }
    }), _el$19);
    _$insert3(_el$18, _$createComponent3(Show3, {
      get when() {
        return props.onTogglePin;
      },
      get children() {
        return _$createComponent3(HudButton, {
          get theme() {
            return theme();
          },
          get label() {
            return props.pinned ? "unpin" : "pin";
          },
          get mono() {
            return mono();
          },
          onPress: () => props.onTogglePin?.()
        });
      }
    }), _el$19);
    _$insert3(_el$18, _$createComponent3(HudButton, {
      get theme() {
        return theme();
      },
      label: "clear goal",
      get mono() {
        return mono();
      },
      get onPress() {
        return props.onClear;
      }
    }), _el$19);
    _$setProp3(_el$19, "flexGrow", 1);
    _$insert3(_el$18, _$createComponent3(HudButton, {
      get theme() {
        return theme();
      },
      label: "esc",
      get mono() {
        return mono();
      },
      get onPress() {
        return props.onClose;
      }
    }), null);
    _$insert3(_el$0, _$createComponent3(Show3, {
      get when() {
        return props.contextOpen;
      },
      get children() {
        var _el$20 = _$createElement3("box");
        _$setProp3(_el$20, "flexDirection", "column");
        _$setProp3(_el$20, "marginTop", 0);
        _$insert3(_el$20, _$createComponent3(HudMenuRow, {
          get theme() {
            return theme();
          },
          get mono() {
            return mono();
          },
          gutter: "menu",
          text: "copy condition",
          get onPress() {
            return menuAction(copyCondition);
          }
        }), null);
        _$insert3(_el$20, _$createComponent3(HudMenuRow, {
          get theme() {
            return theme();
          },
          get mono() {
            return mono();
          },
          gutter: "",
          text: "copy evaluator reason",
          get enabled() {
            return Boolean(g().reason && props.onCopyReason);
          },
          get onPress() {
            return menuAction(() => {
              const r = g().reason;
              if (r)
                props.onCopyReason?.(r);
            });
          }
        }), null);
        _$insert3(_el$20, _$createComponent3(HudMenuRow, {
          get theme() {
            return theme();
          },
          get mono() {
            return mono();
          },
          gutter: "",
          text: "copy latest summary",
          get enabled() {
            return Boolean(latestSummary() && props.onCopySummary);
          },
          get onPress() {
            return menuAction(() => {
              const s = latestSummary();
              if (s)
                props.onCopySummary?.(s);
            });
          }
        }), null);
        _$insert3(_el$20, _$createComponent3(HudMenuRow, {
          get theme() {
            return theme();
          },
          get mono() {
            return mono();
          },
          gutter: "",
          text: "clear goal",
          danger: true,
          get onPress() {
            return menuAction(() => props.onClear());
          }
        }), null);
        return _el$20;
      }
    }), null);
    _$effect3((_p$) => {
      var _v$8 = props.width ?? 64, _v$9 = borderColor(), _v$0 = theme().background?.raised?.high, _v$1 = ` ${title()} `, _v$10 = stateColor(), _v$11 = theme().text.faint, _v$12 = theme().text.base, _v$13 = conditionHovered() ? TextAttributes3.UNDERLINE : undefined, _v$14 = theme().text.faint, _v$15 = stateColor(), _v$16 = TextAttributes3.BOLD, _v$17 = theme().text.muted;
      _v$8 !== _p$.e && (_p$.e = _$setProp3(_el$0, "width", _v$8, _p$.e));
      _v$9 !== _p$.t && (_p$.t = _$setProp3(_el$0, "borderColor", _v$9, _p$.t));
      _v$0 !== _p$.a && (_p$.a = _$setProp3(_el$0, "backgroundColor", _v$0, _p$.a));
      _v$1 !== _p$.o && (_p$.o = _$setProp3(_el$0, "title", _v$1, _p$.o));
      _v$10 !== _p$.i && (_p$.i = _$setProp3(_el$0, "titleColor", _v$10, _p$.i));
      _v$11 !== _p$.n && (_p$.n = _$setProp3(_el$10, "fg", _v$11, _p$.n));
      _v$12 !== _p$.s && (_p$.s = _$setProp3(_el$12, "fg", _v$12, _p$.s));
      _v$13 !== _p$.h && (_p$.h = _$setProp3(_el$12, "attributes", _v$13, _p$.h));
      _v$14 !== _p$.r && (_p$.r = _$setProp3(_el$14, "fg", _v$14, _p$.r));
      _v$15 !== _p$.d && (_p$.d = _$setProp3(_el$16, "fg", _v$15, _p$.d));
      _v$16 !== _p$.l && (_p$.l = _$setProp3(_el$16, "attributes", _v$16, _p$.l));
      _v$17 !== _p$.u && (_p$.u = _$setProp3(_el$17, "fg", _v$17, _p$.u));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined,
      l: undefined,
      u: undefined
    });
    return _el$0;
  })();
};

// src/core/entries.ts
var ENTRY_CAP = 64;
function pruneSnapshotEntries(entries, keep, cap = ENTRY_CAP) {
  let changed = false;
  const out = {};
  for (const [sessionID, entry] of Object.entries(entries)) {
    if (entry.goal === null && sessionID !== keep) {
      changed = true;
      continue;
    }
    out[sessionID] = entry;
  }
  const keys = Object.keys(out);
  if (keys.length > cap) {
    const rank = (k) => {
      const g = out[k].goal;
      return g !== null && isLive(g.status) ? 1 : 0;
    };
    const sorted = keys.slice().sort((a, b) => rank(a) - rank(b) || out[a].receivedAt - out[b].receivedAt);
    let overflow = keys.length - cap;
    for (const k of sorted) {
      if (overflow <= 0)
        break;
      if (k === keep || rank(k) === 1)
        continue;
      delete out[k];
      overflow--;
      changed = true;
    }
  }
  return changed ? out : entries;
}
function preserveContextSize(previous, next) {
  if (next === null)
    return next;
  if (next.contextSize !== undefined)
    return next;
  const carried = previous?.contextSize;
  return typeof carried === "number" && Number.isFinite(carried) && carried >= 0 ? { ...next, contextSize: carried } : next;
}

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var sessionInput = {
  type: "object",
  properties: { sessionID: { type: "string" } },
  required: ["sessionID"],
  additionalProperties: false
};
var goal = { anyOf: [{ type: "object" }, { type: "null" }] };
var GoalRpc = Rpc.define({
  id: "goal",
  methods: {
    get: {
      input: sessionInput,
      output: { type: "object", properties: { goal }, required: ["goal"] }
    },
    list: {
      input: { type: "object", additionalProperties: false },
      output: { type: "object", properties: { goals: { type: "array", items: { type: "object" } } }, required: ["goals"] }
    },
    status: {
      input: sessionInput,
      output: { type: "object" }
    },
    clear: {
      input: sessionInput,
      output: { type: "object", properties: { cleared: { type: "boolean" } }, required: ["cleared"] }
    }
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, goal },
        required: ["sessionID", "goal"]
      }
    },
    notice: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          kind: { type: "string" },
          level: { type: "string", enum: ["info", "success", "warning", "error"] },
          title: { type: "string" },
          message: { type: "string" }
        },
        required: ["sessionID", "kind", "level", "title", "message"]
      }
    }
  }
});

// src/core/wire.ts
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isString = (value) => typeof value === "string";
var isBoolean = (value) => typeof value === "boolean";
var isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
var GOAL_STATUSES = new Set(["active", "paused", "achieved", "impossible", "cleared", "failed"]);
var PAUSE_CAUSES = new Set(["cap", "stall", "user"]);
var isPauseCause = (value) => isString(value) && PAUSE_CAUSES.has(value);
var isGoalStatus = (value) => isString(value) && GOAL_STATUSES.has(value);
var VERDICTS = new Set(["met", "not_met", "impossible"]);
var isVerdict = (value) => isString(value) && VERDICTS.has(value);
var NOTICE_KINDS = new Set([
  "set",
  "status",
  "cleared",
  "achieved",
  "impossible",
  "paused",
  "resumed",
  "retry",
  "failed",
  "checkin",
  "error",
  "compact",
  "loop"
]);
var isNoticeKind = (value) => isString(value) && NOTICE_KINDS.has(value);
var NOTICE_LEVELS = new Set(["info", "success", "warning", "error"]);
var isNoticeLevel = (value) => isString(value) && NOTICE_LEVELS.has(value);
var isUsageSnapshot = (value) => isRecord(value) && isFiniteNumber(value.cost) && isFiniteNumber(value.input) && isFiniteNumber(value.output) && isFiniteNumber(value.reasoning) && isFiniteNumber(value.cacheRead) && isFiniteNumber(value.cacheWrite);
var isVerdictEntry = (value) => isRecord(value) && isFiniteNumber(value.turn) && isVerdict(value.verdict) && isString(value.reason) && isFiniteNumber(value.at);
var isLoopEntry = (value) => isRecord(value) && isFiniteNumber(value.version) && isString(value.condition) && isString(value.summary) && isString(value.reason) && isFiniteNumber(value.turns) && isFiniteNumber(value.toolCalls) && isFiniteNumber(value.endedAt) && (value.contextTokens === undefined || isFiniteNumber(value.contextTokens));
var isLoopCompact = (value) => isRecord(value) && isFiniteNumber(value.requestedAt) && isFiniteNumber(value.iteration) && isFiniteNumber(value.misses) && (value.estimatedTokens === undefined || isFiniteNumber(value.estimatedTokens)) && (value.landedAt === undefined || isFiniteNumber(value.landedAt)) && (value.unmeasurableTicks === undefined || isFiniteNumber(value.unmeasurableTicks)) && (value.stalenessUnknown === undefined || isBoolean(value.stalenessUnknown)) && (value.unwillingWarned === undefined || isBoolean(value.unwillingWarned));
var isGoalSnapshot = (value) => {
  if (!isRecord(value))
    return false;
  if (value.version !== 1)
    return false;
  if (!isString(value.id) || value.id === "" || !isString(value.sessionID) || value.sessionID === "" || !isString(value.directory) || !isString(value.condition))
    return false;
  if (!isGoalStatus(value.status))
    return false;
  if (value.reason !== undefined && !isString(value.reason))
    return false;
  if (value.pauseCause !== undefined && !isPauseCause(value.pauseCause))
    return false;
  if (value.failureLabel !== undefined && !isString(value.failureLabel))
    return false;
  if (value.verdict !== undefined && !isVerdict(value.verdict))
    return false;
  if (!isFiniteNumber(value.setAt) || !isFiniteNumber(value.startedAt))
    return false;
  if (value.endedAt !== undefined && !isFiniteNumber(value.endedAt))
    return false;
  if (!isFiniteNumber(value.turns) || !isFiniteNumber(value.stall) || !isFiniteNumber(value.retries) || !isFiniteNumber(value.checkins))
    return false;
  if (!isUsageSnapshot(value.baseline))
    return false;
  if (value.final !== undefined && !isUsageSnapshot(value.final))
    return false;
  if (!Array.isArray(value.history) || !value.history.every(isVerdictEntry))
    return false;
  if (!isFiniteNumber(value.elapsedMs) || !isBoolean(value.evaluating) || !isBoolean(value.waiting))
    return false;
  if (value.spend !== undefined && !isUsageSnapshot(value.spend))
    return false;
  if (value.contextSize !== undefined && !isFiniteNumber(value.contextSize))
    return false;
  if (value.compactAtTokens !== undefined && !isFiniteNumber(value.compactAtTokens))
    return false;
  if (value.loopEnabled !== undefined && !isBoolean(value.loopEnabled))
    return false;
  if (value.loopIteration !== undefined && !isFiniteNumber(value.loopIteration))
    return false;
  if (value.loopObjective !== undefined && !isString(value.loopObjective))
    return false;
  if (value.loopMaxLoops !== undefined && !isFiniteNumber(value.loopMaxLoops))
    return false;
  if (value.loopNotProgress !== undefined && !isFiniteNumber(value.loopNotProgress))
    return false;
  if (value.loopHistory !== undefined && (!Array.isArray(value.loopHistory) || !value.loopHistory.every(isLoopEntry)))
    return false;
  if (value.loopCompact !== undefined && !isLoopCompact(value.loopCompact))
    return false;
  return true;
};
var parseGoalSnapshot = (value) => isGoalSnapshot(value) ? value : undefined;
var parseGetGoalOutput = (value) => {
  if (!isRecord(value))
    return;
  const goal = value.goal;
  if (goal === null)
    return { goal: null };
  const parsed = parseGoalSnapshot(goal);
  return parsed ? { goal: parsed } : undefined;
};
var parseChangedEvent = (value) => {
  if (!isRecord(value))
    return;
  const sessionID = value.sessionID;
  if (!isString(sessionID) || sessionID === "")
    return;
  const goal = value.goal;
  if (goal === null || goal === undefined)
    return { sessionID, goal: null };
  const parsed = parseGoalSnapshot(goal);
  return parsed ? { sessionID, goal: parsed } : undefined;
};
var parseNotice = (value) => {
  if (!isRecord(value))
    return;
  const { sessionID, kind, level, title, message } = value;
  if (!isString(sessionID) || sessionID === "")
    return;
  if (!isNoticeKind(kind) || !isNoticeLevel(level))
    return;
  if (!isString(title) || !isString(message))
    return;
  return { sessionID, kind, level, title, message };
};

// src/tui.tsx
var TICK_MS = 15000;
var ATTENTION_KINDS = new Set(["achieved", "impossible", "failed", "paused"]);
var elapsedOf = (g, receivedAt, nowMs) => g.status === "active" ? g.elapsedMs + Math.max(0, nowMs - (receivedAt ?? nowMs)) : g.elapsedMs;
var goalsEqual = (a, b) => {
  if (a === b)
    return true;
  if (!a || !b)
    return false;
  return JSON.stringify(a) === JSON.stringify(b);
};
var ClampedColumn = (props) => {
  const dimensions = useTerminalDimensions2();
  return (() => {
    var _el$ = _$createElement4("box");
    _$setProp4(_el$, "flexDirection", "column");
    _$setProp4(_el$, "height", "100%");
    _$setProp4(_el$, "paddingLeft", 3);
    _$setProp4(_el$, "paddingRight", 3);
    _$setProp4(_el$, "paddingBottom", 1);
    _$setProp4(_el$, "gap", 1);
    _$insert4(_el$, () => props.children);
    _$effect4((_$p) => _$setProp4(_el$, "maxHeight", Math.max(8, dimensions().height - 1), _$p));
    return _el$;
  })();
};
var tui_default = Plugin.define({
  id: "opencode-goal.tui",
  setup(context) {
    const rpc = context.client.rpc(GoalRpc);
    const [entries, setEntries] = createSignal4({});
    const [now, setNow] = createSignal4(Date.now());
    const [statusDialogOpen, setStatusDialogOpen] = createSignal4(false);
    const [statusDialogSession, setStatusDialogSession] = createSignal4(undefined);
    const [scrollRef, setScrollRef] = createSignal4(undefined);
    const requested = new Set;
    const statusBody = (sessionID, fallback) => {
      const entry = () => entries()[sessionID];
      const goal = () => entry()?.goal ?? undefined;
      const elapsed = () => {
        const g = goal();
        return g ? elapsedOf(g, entry()?.receivedAt, now()) : 0;
      };
      return _$createComponent4(StatusDialogBody, {
        get goal() {
          return goal();
        },
        fallback,
        get theme() {
          return context.theme;
        },
        elapsedMs: elapsed,
        nowMs: () => now(),
        onCopyCondition: (condition) => copyToClipboard(condition, sessionID),
        onCopyReason: (reason) => copyToClipboard(reason, sessionID, "reason"),
        onCopySummary: (summary) => copyToClipboard(summary, sessionID, "summary"),
        mono: reducedColor
      });
    };
    const closeStatusDialog = () => {
      try {
        context.ui.dialog.clear();
      } catch {}
      setStatusDialogOpen(false);
      setStatusDialogSession(undefined);
      setScrollRef(undefined);
    };
    const showStatusDialog = (sessionID, fallback) => {
      try {
        showStatusDialogInner(sessionID, fallback);
      } catch (error) {
        try {
          context.ui.toast.show({
            title: "goal plugin error (dialog)",
            message: String(error instanceof Error ? error.stack ?? error : error).slice(0, 900),
            variant: "error",
            duration: 30000
          });
        } catch {}
      }
    };
    const showStatusDialogInner = (sessionID, fallback) => {
      setScrollRef(undefined);
      setStatusEscHovered(false);
      refresh(sessionID).catch(() => {});
      const looped = () => Boolean(entries()[sessionID]?.goal?.loopEnabled);
      const loopPosition = () => {
        const g = entries()[sessionID]?.goal;
        if (!g?.loopEnabled)
          return "";
        const iteration = g.loopIteration ?? 1;
        const cap = typeof g.loopMaxLoops === "number" && g.loopMaxLoops > 0 ? `/${g.loopMaxLoops}` : "";
        return ` \xB7 v${iteration}${cap}`;
      };
      context.ui.dialog.show(() => _$createComponent4(ClampedColumn, {
        get children() {
          return [(() => {
            var _el$2 = _$createElement4("box"), _el$3 = _$createElement4("text"), _el$4 = _$createTextNode4(` /goal`), _el$5 = _$createElement4("box"), _el$6 = _$createElement4("text");
            _$insertNode4(_el$2, _el$3);
            _$insertNode4(_el$2, _el$5);
            _$setProp4(_el$2, "flexDirection", "row");
            _$setProp4(_el$2, "justifyContent", "space-between");
            _$setProp4(_el$2, "gap", 2);
            _$insertNode4(_el$3, _el$4);
            _$insert4(_el$3, GOAL_GLYPH, _el$4);
            _$insert4(_el$3, (() => {
              var _c$ = _$memo4(() => !!looped());
              return () => _c$() ? ` \xB7 loop${loopPosition()}` : "";
            })(), null);
            _$insertNode4(_el$5, _el$6);
            _$setProp4(_el$5, "flexShrink", 0);
            _$setProp4(_el$5, "paddingLeft", 1);
            _$setProp4(_el$5, "paddingRight", 1);
            _$setProp4(_el$5, "onMouseUp", (event) => {
              if (event.button !== 0)
                return;
              event.stopPropagation();
              closeStatusDialog();
            });
            _$setProp4(_el$5, "onMouseOver", () => setStatusEscHovered(true));
            _$setProp4(_el$5, "onMouseOut", () => setStatusEscHovered(false));
            _$insertNode4(_el$6, _$createTextNode4(`esc`));
            _$effect4((_p$) => {
              var _v$ = TextAttributes4.BOLD, _v$2 = context.theme.text.base, _v$3 = statusEscHovered() ? context.theme.text.base : context.theme.text.muted, _v$4 = statusEscHovered() ? TextAttributes4.UNDERLINE : undefined;
              _v$ !== _p$.e && (_p$.e = _$setProp4(_el$3, "attributes", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp4(_el$3, "fg", _v$2, _p$.t));
              _v$3 !== _p$.a && (_p$.a = _$setProp4(_el$6, "fg", _v$3, _p$.a));
              _v$4 !== _p$.o && (_p$.o = _$setProp4(_el$6, "attributes", _v$4, _p$.o));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined
            });
            return _el$2;
          })(), (() => {
            var _el$8 = _$createElement4("scrollbox");
            _$use((el) => setScrollRef(el), _el$8);
            _$setProp4(_el$8, "scrollX", false);
            _$setProp4(_el$8, "flexGrow", 1);
            _$setProp4(_el$8, "stickyScroll", false);
            _$setProp4(_el$8, "contentOptions", {
              minHeight: 0
            });
            _$insert4(_el$8, () => statusBody(sessionID, fallback));
            return _el$8;
          })(), _$createComponent4(DialogFooter, {
            get theme() {
              return context.theme;
            },
            mono: reducedColor,
            pinned: () => isPinned(sessionID),
            copied: statusCopied,
            onCopy: () => {
              copyToClipboard(entries()[sessionID]?.goal?.condition ?? fallback, sessionID);
              flashStatusCopied();
            },
            onTogglePin: () => togglePin(sessionID),
            onClear: () => requestClearGoal(sessionID)
          })];
        }
      }), () => {
        setStatusDialogOpen(false);
        setStatusDialogSession(undefined);
        setScrollRef(undefined);
      });
      context.ui.dialog.set({
        size: "xlarge",
        centered: true
      });
      setStatusDialogOpen(true);
      setStatusDialogSession(sessionID);
    };
    const at = (sessionID) => {
      const location = context.data.session.get(sessionID)?.location ?? context.location;
      return location ? {
        location
      } : undefined;
    };
    const [terminalAcks, setTerminalAcks] = createSignal4({});
    const [flashing, setFlashing] = createSignal4(new Set);
    const [landing, setLanding] = createSignal4(new Set);
    const terminalTimers = new Set;
    const noteLanding = (sessionID) => {
      setLanding((previous) => new Set(previous).add(sessionID));
      const timer = setTimeout(() => {
        terminalTimers.delete(timer);
        setLanding((previous) => {
          if (!previous.has(sessionID))
            return previous;
          const next = new Set(previous);
          next.delete(sessionID);
          return next;
        });
      }, LANDING_ACK_MS);
      terminalTimers.add(timer);
    };
    const noteTerminal = (sessionID, goal) => {
      const ack = {
        goal,
        at: Date.now()
      };
      setTerminalAcks((previous) => ({
        ...previous,
        [sessionID]: ack
      }));
      if (goal.status === "achieved") {
        setFlashing((previous) => new Set(previous).add(sessionID));
        const flashTimer = setTimeout(() => {
          terminalTimers.delete(flashTimer);
          setFlashing((previous) => {
            if (!previous.has(sessionID))
              return previous;
            const next = new Set(previous);
            next.delete(sessionID);
            return next;
          });
        }, ACK_FLASH_MS);
        terminalTimers.add(flashTimer);
      }
      const timer = setTimeout(() => {
        terminalTimers.delete(timer);
        setTerminalAcks((previous) => {
          if (previous[sessionID]?.at !== ack.at)
            return previous;
          const next = {
            ...previous
          };
          delete next[sessionID];
          return next;
        });
      }, TERMINAL_ACK_MS);
      terminalTimers.add(timer);
    };
    const dropTerminal = (sessionID) => {
      setTerminalAcks((previous) => {
        if (!previous[sessionID])
          return previous;
        const next = {
          ...previous
        };
        delete next[sessionID];
        return next;
      });
      setFlashing((previous) => {
        if (!previous.has(sessionID))
          return previous;
        const next = new Set(previous);
        next.delete(sessionID);
        return next;
      });
      setLanding((previous) => {
        if (!previous.has(sessionID))
          return previous;
        const next = new Set(previous);
        next.delete(sessionID);
        return next;
      });
    };
    const refresh = (sessionID) => rpc.get({
      sessionID
    }, at(sessionID)).then((result) => {
      const output = parseGetGoalOutput(result);
      if (output)
        put(sessionID, output.goal);
    });
    const put = (sessionID, goal) => {
      try {
        const previous = entries()[sessionID]?.goal;
        const unchanged = previous && goal ? goalsEqual(previous, goal) : false;
        if (!unchanged && goal && previous && isLive(previous.status) && !isLive(goal.status) && goal.status !== "cleared") {
          noteTerminal(sessionID, goal);
        } else if (goal && isLive(goal.status)) {
          dropTerminal(sessionID);
        }
        const previousCompact = previous?.loopCompact;
        const wasPending = previousCompact !== undefined && previousCompact.landedAt === undefined;
        if (!unchanged && goal && goal.loopCompact?.landedAt !== undefined && wasPending)
          noteLanding(sessionID);
      } catch {}
      const mergedGoal = preserveContextSize(entries()[sessionID]?.goal, goal);
      return setEntries((previous) => {
        const existing = previous[sessionID];
        if (existing && goalsEqual(existing.goal, mergedGoal))
          return previous;
        const next = {
          ...previous,
          [sessionID]: {
            goal: mergedGoal,
            receivedAt: Date.now()
          }
        };
        return pruneSnapshotEntries(next, statusDialogSession());
      });
    };
    const ensure = (sessionID) => {
      if (requested.has(sessionID))
        return;
      requested.add(sessionID);
      refresh(sessionID).catch(() => requested.delete(sessionID));
    };
    const live = (sessionID) => {
      try {
        if (!sessionID)
          return;
        ensure(sessionID);
        const goal = entries()[sessionID]?.goal;
        return goal && isLive(goal.status) ? goal : undefined;
      } catch {
        return;
      }
    };
    const currentSession = () => {
      try {
        const route = context.ui.router.current();
        return route.type === "session" ? route.sessionID : undefined;
      } catch {
        return;
      }
    };
    const safeToast = (options) => {
      try {
        context.ui.toast.show({
          ...options,
          variant: options.variant ?? "info"
        });
      } catch {}
    };
    const onNotice = (notice) => {
      try {
        onNoticeInner(notice);
      } catch {
        safeToast({
          title: "goal plugin notice handler failed",
          message: "see logs",
          variant: "error",
          duration: 8000
        });
      }
    };
    const onNoticeInner = (notice) => {
      const here = currentSession() === notice.sessionID;
      if (notice.kind === "status") {
        showStatusDialog(notice.sessionID, notice.message);
        return;
      }
      const important = ATTENTION_KINDS.has(notice.kind);
      if (!here && !important)
        return;
      safeToast({
        title: `${GOAL_GLYPH} ${notice.title}`,
        message: notice.message,
        variant: notice.level,
        sessionID: notice.sessionID,
        duration: notice.level === "error" || notice.level === "warning" ? 8000 : 4000
      });
      if (important)
        try {
          context.attention.notify({
            title: `OpenCode \xB7 ${notice.title}`,
            message: notice.message,
            notification: {
              when: "blurred"
            },
            sound: {
              name: notice.kind === "achieved" ? "done" : "error",
              when: "blurred"
            }
          });
        } catch {}
    };
    const offChanged = rpc.events.on("changed", (event) => {
      try {
        const parsed = parseChangedEvent(event?.data);
        if (parsed)
          put(parsed.sessionID, parsed.goal);
      } catch {}
    });
    const offNotice = rpc.events.on("notice", (event) => {
      try {
        const notice = parseNotice(event?.data);
        if (notice)
          onNotice(notice);
      } catch {}
    });
    const timer = setInterval(() => {
      if (Object.values(entries()).some((entry) => entry.goal?.status === "active"))
        setNow(Date.now());
    }, TICK_MS);
    const [pinned, setPinned] = createSignal4(new Set);
    const isPinned = (sessionID) => Boolean(sessionID && pinned().has(sessionID));
    const togglePin = (sessionID) => {
      if (!sessionID)
        return;
      setPinned((previous) => {
        const next = new Set(previous);
        if (next.has(sessionID))
          next.delete(sessionID);
        else
          next.add(sessionID);
        return next;
      });
    };
    const motionOk = !motionDisabled(process.env);
    const reducedColor = !motionOk;
    const [pulse, setPulse] = createSignal4(false);
    const [getHudSession, setHudSession] = createSignal4(undefined);
    const [statusCopied, setStatusCopied] = createSignal4(false);
    const [contextOpen, setContextOpen] = createSignal4(false);
    const [statusEscHovered, setStatusEscHovered] = createSignal4(false);
    let statusCopiedTimer;
    const flashStatusCopied = () => {
      setStatusCopied(true);
      if (statusCopiedTimer)
        clearTimeout(statusCopiedTimer);
      statusCopiedTimer = setTimeout(() => setStatusCopied(false), 1600);
    };
    const copyLabel = {
      condition: {
        title: "condition copied",
        message: "goal condition is on the clipboard"
      },
      reason: {
        title: "reason copied",
        message: "the evaluator's reason is on the clipboard"
      },
      summary: {
        title: "summary copied",
        message: "the iteration summary is on the clipboard"
      }
    };
    const copyToClipboard = (text, sessionID, what = "condition") => {
      try {
        const ok = context.renderer.copyToClipboardOSC52(text);
        const label = copyLabel[what];
        safeToast({
          title: ok ? label.title : "copy unavailable",
          message: ok ? label.message : "the terminal refused OSC52 clipboard access",
          variant: ok ? "success" : "warning",
          duration: 3000,
          sessionID
        });
      } catch (error) {
        safeToast({
          title: "copy failed",
          message: String(error instanceof Error ? error : error).slice(0, 200),
          variant: "error",
          duration: 5000,
          sessionID
        });
      }
    };
    const requestClearGoal = (sessionID) => {
      if (!sessionID)
        return;
      try {
        const g = live(sessionID) ?? entries()[sessionID]?.goal;
        const message = g?.loopEnabled ? `Clear the armed loop (iteration ${g.loopIteration ?? 1}${typeof g.loopMaxLoops === "number" && g.loopMaxLoops > 0 ? ` of at most ${g.loopMaxLoops}` : ""}) and its full history? This cannot be undone.` : "Clear the armed goal and its history? This cannot be undone.";
        context.ui.dialog.confirm({
          title: "Clear goal",
          message,
          label: {
            confirm: "clear goal",
            cancel: "keep"
          }
        }).then((ok) => {
          if (ok !== true)
            return;
          const clearFailed = (error) => safeToast({
            title: "clear failed",
            message: String(error instanceof Error ? error : error).slice(0, 200),
            variant: "error",
            duration: 5000,
            sessionID
          });
          try {
            rpc.clear({
              sessionID
            }, at(sessionID)).catch(clearFailed);
          } catch (error) {
            clearFailed(error);
          }
        }).catch(() => {});
      } catch {}
    };
    const openDashboard = (sessionID) => {
      if (!sessionID)
        return;
      try {
        const g = entries()[sessionID]?.goal;
        setHudSession(undefined);
        showStatusDialog(sessionID, g?.condition ?? "goal");
      } catch {}
    };
    context.ui.slot({
      append: "session.composer.top",
      render: (props) => {
        const [hovered, setHovered] = createSignal4(false);
        const goal = createMemo(() => {
          try {
            return live(props.sessionID);
          } catch {
            return;
          }
        });
        const terminal = () => {
          try {
            return props.sessionID ? terminalAcks()[props.sessionID]?.goal : undefined;
          } catch {
            return;
          }
        };
        const showing = () => goal() ?? terminal();
        const elapsed = () => {
          try {
            const g = goal();
            if (!g || !props.sessionID)
              return 0;
            return elapsedOf(g, entries()[props.sessionID]?.receivedAt, now());
          } catch {
            return 0;
          }
        };
        const pill = () => {
          try {
            const g = goal();
            const budget = Math.max(1, dimensions().width - 4 - (landingNow() ? LANDING_SUFFIX.length : 0));
            if (g)
              return pillModel(g, elapsed(), motionDisabled(process.env), budget);
            const t = terminal();
            return t ? terminalPill(t, t.elapsedMs) : undefined;
          } catch {
            return;
          }
        };
        const dimensions = useTerminalDimensions2();
        const pinnedNow = () => isPinned(props.sessionID);
        const landingNow = () => props.sessionID !== undefined && landing().has(props.sessionID);
        const caret = () => pillCaret(getHudSession() === props.sessionID && cardFor() !== undefined, motionDisabled(process.env)) + " ";
        const pillText = () => {
          const model = pill();
          if (!model)
            return "";
          const landed = landingNow() ? LANDING_SUFFIX : "";
          const prefix = caret();
          if (!pinnedNow())
            return prefix + model.text + landed;
          const g = goal();
          const base = prefix + model.text + landed;
          return g ? base + pinSuffix(g.condition, pinBudget(dimensions().width, base.length)) : base;
        };
        const animated = () => {
          const g = goal();
          return pillMotionNeeded({
            evaluating: g?.evaluating === true,
            hot: g !== undefined && isCompactHot(g),
            flashing: props.sessionID !== undefined && flashing().has(props.sessionID),
            landing: landingNow()
          });
        };
        createEffect(() => {
          if (animated() && motionOk) {
            const timer = setInterval(() => setPulse((value) => !value), 850);
            onCleanup3(() => clearInterval(timer));
            return;
          }
          setPulse(false);
        });
        const pillAttrs = () => {
          const underline = hovered() ? TextAttributes4.UNDERLINE : 0;
          const bold = animated() && pulse() && motionOk ? TextAttributes4.BOLD : 0;
          const attrs = underline | bold;
          return attrs === 0 ? undefined : attrs;
        };
        const color = () => {
          if (reducedColor)
            return context.theme.text.muted;
          if (landingNow())
            return context.theme.text.feedback.info.base;
          const tone = pill()?.tone;
          if (tone === "paused" || tone === "hot" || tone === "retrying" || tone === "impossible")
            return context.theme.text.feedback.warning.base;
          if (tone === "failed")
            return context.theme.text.feedback.error?.base ?? context.theme.text.feedback.warning.base;
          if (tone === "achieved" || tone === "evaluating" || tone === "waiting")
            return context.theme.text.feedback.info.base;
          return context.theme.text.muted;
        };
        const cardFor = () => {
          const g = showing();
          return g && getHudSession() === props.sessionID ? g : undefined;
        };
        const maxCardRows = () => Math.max(8, dimensions().height - 2);
        const cardRows = () => {
          const g = cardFor();
          return g ? hudCardRows(g, contextOpen(), maxCardRows()) : 0;
        };
        const toggleHud = () => {
          try {
            setContextOpen(false);
            setHudSession((current) => props.sessionID && current === props.sessionID ? undefined : props.sessionID);
          } catch {}
        };
        return _$createComponent4(Show4, {
          get when() {
            return showing();
          },
          get children() {
            return [(() => {
              var _el$9 = _$createElement4("box"), _el$0 = _$createElement4("text");
              _$insertNode4(_el$9, _el$0);
              _$setProp4(_el$9, "position", "absolute");
              _$setProp4(_el$9, "top", -1);
              _$setProp4(_el$9, "left", 0);
              _$setProp4(_el$9, "height", 1);
              _$setProp4(_el$9, "paddingLeft", 1);
              _$setProp4(_el$9, "flexDirection", "row");
              _$setProp4(_el$9, "onMouseOver", () => setHovered(true));
              _$setProp4(_el$9, "onMouseOut", () => setHovered(false));
              _$setProp4(_el$9, "onMouseUp", (event) => {
                try {
                  if (!props.sessionID)
                    return;
                  if (event.button === 2)
                    openDashboard(props.sessionID);
                  else if (event.button === 0)
                    toggleHud();
                } catch {}
              });
              _$setProp4(_el$0, "wrapMode", "none");
              _$insert4(_el$0, pillText);
              _$effect4((_p$) => {
                var _v$5 = color(), _v$6 = pillAttrs();
                _v$5 !== _p$.e && (_p$.e = _$setProp4(_el$0, "fg", _v$5, _p$.e));
                _v$6 !== _p$.t && (_p$.t = _$setProp4(_el$0, "attributes", _v$6, _p$.t));
                return _p$;
              }, {
                e: undefined,
                t: undefined
              });
              return _el$9;
            })(), _$createComponent4(Show4, {
              get when() {
                return cardFor();
              },
              children: (g) => (() => {
                var _el$1 = _$createElement4("box");
                _$setProp4(_el$1, "position", "absolute");
                _$setProp4(_el$1, "left", 0);
                _$setProp4(_el$1, "zIndex", 10);
                _$insert4(_el$1, _$createComponent4(HudCard, {
                  get goal() {
                    return g();
                  },
                  get theme() {
                    return context.theme;
                  },
                  mono: reducedColor,
                  elapsedMs: elapsed,
                  onClose: () => {
                    setContextOpen(false);
                    setHudSession(undefined);
                  },
                  onDetails: () => {
                    setContextOpen(false);
                    openDashboard(props.sessionID);
                  },
                  onClear: () => {
                    setContextOpen(false);
                    setHudSession(undefined);
                    requestClearGoal(props.sessionID);
                  },
                  onCopyCondition: (condition) => copyToClipboard(condition, props.sessionID),
                  get contextOpen() {
                    return contextOpen();
                  },
                  get maxRows() {
                    return maxCardRows();
                  },
                  onToggleContext: () => setContextOpen((v) => !v),
                  onCloseMenu: () => setContextOpen(false),
                  onCopyReason: (reason) => copyToClipboard(reason, props.sessionID, "reason"),
                  onCopySummary: (summary) => copyToClipboard(summary, props.sessionID, "summary"),
                  get pinned() {
                    return pinnedNow();
                  },
                  onTogglePin: () => togglePin(props.sessionID)
                }));
                _$effect4((_p$) => {
                  var _v$7 = -cardRows(), _v$8 = cardRows();
                  _v$7 !== _p$.e && (_p$.e = _$setProp4(_el$1, "top", _v$7, _p$.e));
                  _v$8 !== _p$.t && (_p$.t = _$setProp4(_el$1, "height", _v$8, _p$.t));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined
                });
                return _el$1;
              })()
            })];
          }
        });
      }
    });
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      enabled: () => getHudSession() !== undefined,
      commands: [{
        id: "goal.hud.dismiss",
        title: "Goal HUD: dismiss",
        group: "Goal",
        bind: "escape",
        enabled: () => getHudSession() !== undefined,
        run: () => {
          try {
            setContextOpen(false);
            setHudSession(undefined);
          } catch {}
        }
      }]
    }));
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      enabled: () => statusDialogOpen(),
      commands: [{
        id: "goal.status.pin",
        title: "Goal status: toggle pinned condition",
        group: "Goal",
        bind: "p",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            togglePin(statusDialogSession());
          } catch {}
        }
      }, {
        id: "goal.status.copy",
        title: "Goal status: copy condition",
        group: "Goal",
        bind: "c",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            const s = statusDialogSession();
            const condition = s ? entries()[s]?.goal?.condition : undefined;
            if (!condition)
              return;
            copyToClipboard(condition, s);
            flashStatusCopied();
          } catch {}
        }
      }, {
        id: "goal.status.scroll-up",
        title: "Goal status: scroll up",
        group: "Goal",
        bind: "up",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollBy(-3);
          } catch {}
        }
      }, {
        id: "goal.status.scroll-down",
        title: "Goal status: scroll down",
        group: "Goal",
        bind: "down",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollBy(3);
          } catch {}
        }
      }, {
        id: "goal.status.page-up",
        title: "Goal status: page up",
        group: "Goal",
        bind: "pageup",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollBy(-15);
          } catch {}
        }
      }, {
        id: "goal.status.page-down",
        title: "Goal status: page down",
        group: "Goal",
        bind: "pagedown",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollBy(15);
          } catch {}
        }
      }, {
        id: "goal.status.home",
        title: "Goal status: scroll to start",
        group: "Goal",
        bind: "home",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollTo(0);
          } catch {}
        }
      }, {
        id: "goal.status.end",
        title: "Goal status: scroll to end",
        group: "Goal",
        bind: "end",
        enabled: () => statusDialogOpen(),
        run: () => {
          try {
            scrollRef()?.scrollTo(Number.MAX_SAFE_INTEGER);
          } catch {}
        }
      }]
    }));
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "goal.status",
        title: "Goal: show status",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
        run: () => {
          const sessionID = currentSession();
          if (sessionID)
            rpc.status({
              sessionID
            }, at(sessionID)).catch(() => {});
        }
      }, {
        id: "goal.clear",
        title: "Goal: clear",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession())),
        run: () => requestClearGoal(currentSession())
      }, {
        id: "goal.loop.status",
        title: "Goal loop: show status",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession())?.loopEnabled ?? entries()[currentSession() ?? ""]?.goal?.loopEnabled),
        run: () => {
          const sessionID = currentSession();
          if (sessionID)
            rpc.status({
              sessionID
            }, at(sessionID)).catch(() => {});
        }
      }, {
        id: "goal.hud.toggle",
        title: "Goal HUD: toggle card",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
        run: () => {
          try {
            const sessionID = currentSession();
            setContextOpen(false);
            setHudSession((current) => sessionID && current === sessionID ? undefined : sessionID);
          } catch {}
        }
      }, {
        id: "goal.pin.toggle",
        title: "Goal: toggle pinned condition",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal),
        run: () => {
          try {
            togglePin(currentSession());
          } catch {}
        }
      }, {
        id: "goal.condition.copy",
        title: "Goal: copy condition",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal?.condition),
        run: () => {
          try {
            const sessionID = currentSession();
            const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal;
            if (goal?.condition && sessionID)
              copyToClipboard(goal.condition, sessionID);
          } catch {}
        }
      }, {
        id: "goal.reason.copy",
        title: "Goal: copy evaluator reason",
        group: "Goal",
        palette: true,
        enabled: () => Boolean((live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal)?.reason),
        run: () => {
          try {
            const sessionID = currentSession();
            const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal;
            if (goal?.reason && sessionID)
              copyToClipboard(goal.reason, sessionID, "reason");
          } catch {}
        }
      }, {
        id: "goal.summary.copy",
        title: "Goal: copy latest loop summary",
        group: "Goal",
        palette: true,
        enabled: () => Boolean((live(currentSession()) ?? entries()[currentSession() ?? ""]?.goal)?.loopHistory?.at(-1)?.summary),
        run: () => {
          try {
            const sessionID = currentSession();
            const goal = live(sessionID) ?? entries()[sessionID ?? ""]?.goal;
            const summary = goal?.loopHistory?.at(-1)?.summary;
            if (summary && sessionID)
              copyToClipboard(summary, sessionID, "summary");
          } catch {}
        }
      }, {
        id: "goal.loop.clear",
        title: "Goal loop: clear",
        group: "Goal",
        palette: true,
        enabled: () => Boolean(live(currentSession())?.loopEnabled),
        run: () => requestClearGoal(currentSession())
      }]
    }));
    return () => {
      clearInterval(timer);
      for (const pending of terminalTimers)
        clearTimeout(pending);
      terminalTimers.clear();
      setTerminalAcks({});
      offChanged();
      offNotice();
      setFlashing(new Set);
      setLanding(new Set);
      setStatusDialogOpen(false);
      setStatusDialogSession(undefined);
      setScrollRef(undefined);
    };
  }
});
export {
  tui_default as default
};
