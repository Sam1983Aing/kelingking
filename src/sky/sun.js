// Where the sun is, from a date, a time and a place (NOAA's solar position equations,
// good to a small fraction of a degree, which is plenty for shadows).
//
// The viewpoint photo (references/02-viewpoint/viewpoint-midday-a.jpg) is the light target.
// Its EXIF, read from its Wikimedia Commons page, says it was taken on 6 April 2025 at
// 11:57:37 local time (UTC+8) from 8.7514 S, 115.4741 E, on an iPhone 16 at ISO 50,
// f/2.2, 1/1927 s. That puts the sun 73.7 degrees up, at a compass heading of 20.7 degrees
// (just east of north, because Bali is south of the equator and it is not quite noon).

export const PHOTO_DAY = {
  date: '2025-04-06T11:57:37+08:00',
  lat: -8.7514,
  lon: 115.4741,
  // Exposure value at ISO 100 from the EXIF: log2(N^2 / t * 100 / ISO).
  ev100: Math.log2((2.2 * 2.2 * 1927 * 100) / 50),
};

// Sun elevation and compass heading (degrees) at a UTC instant.
export function sunPosition(date, lat, lon) {
  const r = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * r) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * r) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * r) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * r);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * r);
  const decl = Math.asin(Math.sin(eps * r) * Math.sin(lambda * r));
  const y = Math.tan((eps * r) / 2) ** 2;
  const eot = (4 / r) * (y * Math.sin(2 * L0 * r) - 2 * e * Math.sin(M * r)
    + 4 * e * y * Math.sin(M * r) * Math.cos(2 * L0 * r)
    - 0.5 * y * y * Math.sin(4 * L0 * r) - 1.25 * e * e * Math.sin(2 * M * r));
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const ha = ((minutes + eot + 4 * lon) / 4 - 180) * r;
  const cz = Math.sin(lat * r) * Math.sin(decl) + Math.cos(lat * r) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cz)));
  let az = Math.acos(Math.min(1, Math.max(-1,
    (Math.sin(lat * r) * cz - Math.sin(decl)) / (Math.cos(lat * r) * Math.sin(zen))))) / r;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { elevation: 90 - zen / r, azimuth: az };
}

// Local time (hours, UTC+8) on the photo's day, to a sun position. Handy for the GUI.
export function sunAtHour(hours, day = PHOTO_DAY) {
  const d = new Date(day.date);
  const midnightUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + (d.getUTCHours() >= 16 ? 86400000 : 0);
  return sunPosition(new Date(midnightUTC + (hours - 8) * 3600000), day.lat, day.lon);
}

export const PHOTO_HOUR = 11 + 57 / 60 + 37 / 3600;
