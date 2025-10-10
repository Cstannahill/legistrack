module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  verbose: true,
  globals: {
    "ts-jest": {
      isolatedModules: true,
    },
  },
};
