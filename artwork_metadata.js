function normalizeArtworkMetadata({ title, age, medium, category, description }) {
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  const normalizedMedium = typeof medium === 'string' ? medium.trim() : '';
  const categories = typeof category === 'string'
    ? [...new Set(category.split('|').map((value) => value.trim()).filter(Boolean))]
    : [];
  const parsedAge = age === '' || age == null ? NaN : Number(age);

  if (!normalizedTitle || !normalizedMedium || categories.length === 0 || categories.length > 10
    || categories.some((value) => value.length > 80)
    || !Number.isInteger(parsedAge) || parsedAge < 0 || parsedAge > 120) {
    return null;
  }

  return {
    title: normalizedTitle,
    age: parsedAge,
    medium: normalizedMedium,
    category: categories[0],
    categories,
    description: typeof description === 'string' ? description.trim() || null : null,
  };
}

function calculateAgeAtDate(dateValue, birthdayValue) {
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

module.exports = { normalizeArtworkMetadata, calculateAgeAtDate };