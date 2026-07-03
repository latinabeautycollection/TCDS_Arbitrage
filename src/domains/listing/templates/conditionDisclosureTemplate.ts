export function conditionDisclosure(conditionText: string, defects: string[]): string[] {
  const rows = [`Condition is described as: ${conditionText}`];
  for (const d of defects) rows.push(d);
  return rows;
}
