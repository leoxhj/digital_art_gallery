export function calculateAgeAtDate(dateValue, birthdayValue) {
  const parseDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const parsedDate = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) return null;
    return { year, month, day };
  };

  const date = parseDate(dateValue);
  const birthday = parseDate(birthdayValue);
  if (!date || !birthday) return null;

  let age = date.year - birthday.year;
  if (date.month < birthday.month || (date.month === birthday.month && date.day < birthday.day)) age -= 1;
  return age < 0 ? null : age;
}