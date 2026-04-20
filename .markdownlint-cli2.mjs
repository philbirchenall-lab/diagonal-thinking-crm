import noEmdashRule from "./markdownlint-rules/dt-no-emdash.js";

export default {
  config: {
    default: true,
    MD013: false,
    MD024: {
      siblings_only: true,
    },
    MD033: false,
    MD041: false,
    "dt-no-emdash": true,
  },
  customRules: [noEmdashRule],
};
