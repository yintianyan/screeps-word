
module.exports = {
  preset: "ts-jest",
  testEnvironment: "screeps-jest",
  moduleDirectories: ["node_modules", "src"],
  testMatch: ["**/tests/**/*.test.ts", "**/tests/**/*.spec.ts"],
};
