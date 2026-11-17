/**
 * solar.js
 * Real solar position + clear-sky beam irradiance for the shading analyzer.
 *
 * Unlike Scene3D.updateSunPosition (a visual arc for the 3D sun sphere),
 * these functions compute true astronomical sun positions from latitude,
 * day of year, and local solar time. Accuracy is about 0.5-1 degree,
 * which is enough for shading raycasts (a 1-degree sun error moves a
 * shadow by only ~2 cm per metre of occluder height).
 *
 * Conventions:
 * - Azimuth: 0 = North, 90 = East, 180 = South, 270 = West (clockwise).
 * - Elevation: 0 = horizon, 90 = zenith. Negative = sun below horizon.
 * - Solar time: 12.0 = solar noon. No timezone or DST handling is needed
 *   because shading is computed in solar time.
 * - Scene mapping (north = -Z, east = +X): a sun at azimuth A and
 *   elevation E sits in direction (sin A * cos E, sin E, -cos A * cos E).
 */

const Solar = {
  DEG: Math.PI / 180,

  /**
   * Solar declination (degrees) by day of year (1-365).
   * Cooper's approximation.
   */
  declination(dayOfYear) {
    return 23.45 * Math.sin(((2 * Math.PI) / 365) * (284 + dayOfYear));
  },

  /**
   * Sun position for a latitude, day of year, and local solar hour.
   * Returns { elevationDeg, azimuthDeg }.
   */
  sunPosition(dayOfYear, solarHour, latDeg) {
    const lat = latDeg * this.DEG;
    const dec = this.declination(dayOfYear) * this.DEG;
    const hourAngle = (solarHour - 12) * 15 * this.DEG;

    const sinAlt =
      Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

    // Azimuth from north, clockwise. At solar noon in the southern
    // hemisphere this correctly yields ~0 (sun to the north).
    let az = Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)
    ) + Math.PI;
    az = ((az / this.DEG) % 360 + 360) % 360;

    return { elevationDeg: alt / this.DEG, azimuthDeg: az };
  },

  /**
   * Clear-sky direct normal irradiance (W/m2) from solar elevation.
   * Meinel model. Used only as an energy weight for the shading average,
   * not as a yield input, so a simple clear-sky estimate is appropriate.
   */
  clearSkyDni(elevationDeg) {
    if (elevationDeg <= 0) return 0;
    const airMass = 1 / Math.sin(elevationDeg * this.DEG);
    return 1367 * Math.pow(0.7, Math.pow(airMass, 0.678));
  },

  /**
   * Unit vector TOWARD the sun in scene coordinates (north = -Z, east = +X).
   */
  sunDirection(elevationDeg, azimuthDeg) {
    const el = elevationDeg * this.DEG;
    const az = azimuthDeg * this.DEG;
    return {
      x: Math.sin(az) * Math.cos(el),
      y: Math.sin(el),
      z: -Math.cos(az) * Math.cos(el)
    };
  },

  /**
   * Integer solar hours with the sun above the horizon on a given day.
   * From the sunrise hour angle: cos(H0) = -tan(lat) * tan(dec).
   * Sampling the full sun-up period (instead of a fixed 07:00-17:00
   * window) matters because self-shading happens exactly at low sun:
   * at high latitudes the summer sun is up roughly 03:00-21:00, and a
   * fixed window would miss the worst hours. Polar day/night are
   * clamped (never occur at the supported latitudes, max 57 deg).
   * Returns e.g. [6..18] for Jakarta, [4..20] for Oskarshamn in June.
   */
  daylightHours(dayOfYear, latDeg) {
    const lat = latDeg * this.DEG;
    const dec = this.declination(dayOfYear) * this.DEG;
    let cosH0 = -Math.tan(lat) * Math.tan(dec);
    if (cosH0 <= -1) return Array.from({ length: 24 }, (_, i) => i); // polar day
    if (cosH0 >= 1) return []; // polar night
    const h0 = Math.acos(cosH0) / this.DEG;
    const sunrise = 12 - h0 / 15;
    const sunset = 12 + h0 / 15;
    const hours = [];
    for (let h = Math.ceil(sunrise); h <= Math.floor(sunset); h++) hours.push(h);
    return hours;
  },

  /** Day of year for the 15th of a month (1-12), non-leap year. */
  midMonthDay(month) {
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let doy = 15;
    for (let m = 0; m < month - 1; m++) doy += days[m];
    return doy;
  },

  daysInMonth(month) {
    return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
};

// Node test harness: `node js/solar.js` prints reference checks.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Solar;
}
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('solar.js')) {
  const checks = [
    // [label, dayOfYear, hour, lat, expectedElev, expectedAz]
    ['Jakarta equinox noon', 79, 12, -6.2, 83.8, 0],
    ['Jakarta Jun 21 noon', 172, 12, -6.2, 60.4, 0],
    ['Jakarta Dec 21 noon', 355, 12, -6.2, 72.8, 180],
    ['Jakarta equinox 09:00', 79, 9, -6.2, 44.0, 84],
    ['Oskarshamn Jun 21 noon', 172, 12, 57.26, 56.2, 180],
    ['Oskarshamn Dec 21 noon', 355, 12, 57.26, 9.3, 180]
  ];
  let ok = true;
  for (const [label, doy, hr, lat, expEl, expAz] of checks) {
    const p = Solar.sunPosition(doy, hr, lat);
    const dEl = Math.abs(p.elevationDeg - expEl);
    let dAz = Math.abs(p.azimuthDeg - expAz);
    dAz = Math.min(dAz, 360 - dAz);
    const pass = dEl < 1.5 && dAz < 3;
    if (!pass) ok = false;
    console.log(
      `${pass ? 'PASS' : 'FAIL'} ${label}: elev ${p.elevationDeg.toFixed(1)} (exp ~${expEl}), az ${p.azimuthDeg.toFixed(1)} (exp ~${expAz})`
    );
  }
  console.log(`DNI clear-sky at elev 90: ${Solar.clearSkyDni(90).toFixed(0)} W/m2 (expect ~957)`);
  console.log(`DNI clear-sky at elev 30: ${Solar.clearSkyDni(30).toFixed(0)} W/m2 (expect ~760)`);
  const dh = [
    ['Jakarta equinox', Solar.daylightHours(79, -6.2), 6, 18],
    ['Oskarshamn Jun 15', Solar.daylightHours(166, 57.26), 4, 20],
    ['Oskarshamn Dec 15', Solar.daylightHours(349, 57.26), 9, 15]
  ];
  for (const [label, hours, expFirst, expLast] of dh) {
    const pass = hours[0] === expFirst && hours[hours.length - 1] === expLast;
    if (!pass) ok = false;
    console.log(`${pass ? 'PASS' : 'FAIL'} daylight ${label}: ${hours[0]}..${hours[hours.length - 1]} (expect ${expFirst}..${expLast})`);
  }
  if (!ok) process.exit(1);
}
