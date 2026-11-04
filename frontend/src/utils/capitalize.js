// ==============================|| UTILS - CAPITALIZE ||============================== //

/**
 * First letter upper-cased, for showing a stored value as a label — a flight
 * status like 'uploaded' reads as "Uploaded". Only the displayed text changes;
 * the value itself stays as stored, because the API and filters compare on it.
 */
export default function capitalize(text) {
  return typeof text === 'string' && text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
