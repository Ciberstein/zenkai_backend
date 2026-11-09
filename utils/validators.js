const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// At least 8 chars, one lowercase, one uppercase and one digit.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

// 3-20 chars, letters/digits/underscore.
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

const isEmail = (value) => EMAIL_REGEX.test(String(value ?? "").trim());

const isPassword = (value) => PASSWORD_REGEX.test(String(value ?? ""));

const isUsername = (value) => USERNAME_REGEX.test(String(value ?? "").trim());

const isInteger = (value) => Number.isInteger(Number(value));

module.exports = { isEmail, isPassword, isUsername, isInteger };
