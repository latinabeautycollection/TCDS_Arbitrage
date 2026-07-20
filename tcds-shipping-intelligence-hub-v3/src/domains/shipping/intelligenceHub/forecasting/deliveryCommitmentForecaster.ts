export function forecastDeliveryWindow(input: {
  shipByAt: Date;
  transitBusinessDays: number;
  contingencyDays: number;
}): { startAt: Date; endAt: Date } {
  const addBusinessDays = (date: Date, days: number): Date => {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
      result.setUTCDate(result.getUTCDate() + 1);
      const day = result.getUTCDay();
      if (day !== 0 && day !== 6) added += 1;
    }
    return result;
  };
  const startAt = addBusinessDays(input.shipByAt, input.transitBusinessDays);
  const endAt = addBusinessDays(startAt, input.contingencyDays);
  return { startAt, endAt };
}
