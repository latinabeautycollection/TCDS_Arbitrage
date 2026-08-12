export const EMAIL_POLICY = Object.freeze({
  approvedSender: "alerts@tcdsolutionsgroup.com",
  permittedClassifications: new Set(["PUBLIC", "INTERNAL", "CONFIDENTIAL"]),
  forbiddenVariablePatterns: [
    /password/i, /api[_ -]?key/i, /secret/i, /access[_ -]?token/i,
    /refresh[_ -]?token/i, /ssn/i, /social security/i, /credit card/i
  ],
  permittedSeverities: new Set(["INFORMATIONAL","NOTICE","WARNING","HIGH","CRITICAL","EMERGENCY"])
});
