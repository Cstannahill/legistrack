export interface AddDaysOptions {
  in?: Date;
}

export function addDays(
  date: Date | number,
  amount: number,
  options?: AddDaysOptions
): Date;

export default addDays;
