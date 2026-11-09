const formatDate = (date, locale = "es-ES") =>
  new Date(date).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

module.exports = formatDate;
