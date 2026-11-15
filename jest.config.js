import { createDefaultEsmPreset } from "ts-jest";

/** @type {import("jest").Config} **/
export default {
    ...createDefaultEsmPreset(),
    testEnvironment: "node",
    moduleNameMapper: {
        // NodeNext needs .js on relative imports; Jest resolves the .ts source
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
};
