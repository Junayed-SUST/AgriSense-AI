// Tool 1: get_weather — calls Open-Meteo geocoding + forecast APIs (Tier 0 #2)
// Open-Meteo is free, requires no API key, covers Bangladesh.

export interface AgronomicAlert {
  type: 'heat_stress' | 'cold_snap' | 'flood_risk' | 'storm_risk' | 'drought_signal' | 'high_humidity';
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  affectedDates: string[];
  farmingAdvice: string;
}

export interface WeatherResult {
  location: string;
  latitude: number;
  longitude: number;
  timezone: string;
  forecast: {
    date: string;
    tempMaxC: number;
    tempMinC: number;
    precipitationMm: number;
    precipitationProbability: number;
    windMaxKmh: number;
    humidityMeanPercent: number | null;
    et0Mm: number | null;
  }[];
  summary: {
    totalRain7dMm: number;
    avgTempC: number;
    avgHumidityPercent: number | null;
    totalEt0Mm: number | null;
    rainyDays: number;
    nextRainEvent: { date: string; mm: number } | null;
  };
  agronomicAlerts: AgronomicAlert[];
}

// Bangladesh district name aliases — Open-Meteo uses GeoNames which often
// uses older English spellings. Map common transliterations to the form
// GeoNames recognizes.
const BD_LOCATION_ALIASES: Record<string, string> = {
  'bogura': 'Bogra',
  'jashore': 'Jessore',
  'chattogram': 'Chittagong',
  'cumilla': 'Comilla',
  'barishal': 'Barisal',
  'kustia': 'Kushtia',
  'jhenaida': 'Jhenaidah',
  'coxsbazar': "Cox's Bazar",
  'chapainawabganj': 'Nawabganj',
  'moulvibazar': 'Maulvibazar',
};

function normalizeLocation(input: string): string {
  let result = input;
  for (const [alias, canonical] of Object.entries(BD_LOCATION_ALIASES)) {
    const re = new RegExp(`\\b${alias}\\b`, 'gi');
    result = result.replace(re, canonical);
  }
  return result;
}

// ---------- Rule-based agronomic alerts ----------

function generateAgronomicAlerts(forecast: WeatherResult['forecast']): AgronomicAlert[] {
  const alerts: AgronomicAlert[] = [];

  // 1. Heat stress: tempMax > 35°C for 2+ consecutive days
  const hotDays = forecast.filter(f => f.tempMaxC > 35);
  if (hotDays.length >= 2) {
    // Check for consecutive
    let maxConsecutive = 1, current = 1;
    for (let i = 1; i < forecast.length; i++) {
      if (forecast[i].tempMaxC > 35 && forecast[i - 1].tempMaxC > 35) {
        current++;
        maxConsecutive = Math.max(maxConsecutive, current);
      } else if (forecast[i].tempMaxC > 35) {
        current = 1;
      } else {
        current = 0;
      }
    }
    if (maxConsecutive >= 2) {
      const peak = Math.max(...hotDays.map(d => d.tempMaxC));
      alerts.push({
        type: 'heat_stress',
        severity: peak > 40 ? 'critical' : 'warning',
        title: `🔥 Heat Stress Alert (${maxConsecutive} consecutive days > 35°C)`,
        detail: `Peak temperature ${peak.toFixed(1)}°C expected. ${maxConsecutive} consecutive days above 35°C can cause pollen sterility in rice/wheat at flowering and fruit drop in vegetables.`,
        affectedDates: hotDays.map(d => d.date),
        farmingAdvice: 'Ensure standing water (3-5cm) in rice paddies. For vegetables, apply light irrigation in early morning or evening. Avoid fertilizer application during peak heat hours.',
      });
    }
  }

  // 2. Cold snap: tempMin < 10°C
  const coldDays = forecast.filter(f => f.tempMinC < 10);
  if (coldDays.length > 0) {
    const coldest = Math.min(...coldDays.map(d => d.tempMinC));
    alerts.push({
      type: 'cold_snap',
      severity: coldest < 5 ? 'critical' : 'warning',
      title: `🥶 Cold Snap Alert (min ${coldest.toFixed(1)}°C)`,
      detail: `Night-time temperatures dropping to ${coldest.toFixed(1)}°C on ${coldDays.length} day(s). Chilling injury risk for potato/tomato seedlings and Boro rice nurseries.`,
      affectedDates: coldDays.map(d => d.date),
      farmingAdvice: 'Cover seedbeds with polythene/straw at night. Delay transplanting of cold-sensitive crops. For Boro nursery, maintain 2-3cm standing water overnight as thermal buffer.',
    });
  }

  // 3. Flood risk: totalRain > 150mm in 7 days OR single day > 80mm
  const totalRain = forecast.reduce((sum, f) => sum + f.precipitationMm, 0);
  const heavyRainDays = forecast.filter(f => f.precipitationMm > 80);
  if (totalRain > 150 || heavyRainDays.length > 0) {
    const peakDay = forecast.reduce((max, f) => f.precipitationMm > max.precipitationMm ? f : max, forecast[0]);
    alerts.push({
      type: 'flood_risk',
      severity: totalRain > 250 || heavyRainDays.some(d => d.precipitationMm > 120) ? 'critical' : 'warning',
      title: `🌧️ Flood / Waterlogging Risk (${totalRain.toFixed(0)}mm in 7 days)`,
      detail: `Total 7-day rainfall ${totalRain.toFixed(0)}mm with peak ${peakDay.precipitationMm.toFixed(0)}mm on ${peakDay.date}. Risk of waterlogging, root rot, and nutrient leaching.`,
      affectedDates: forecast.filter(f => f.precipitationMm > 20).map(d => d.date),
      farmingAdvice: 'Clear field drainage channels immediately. Postpone fertilizer application (especially urea — runoff loss). Harvest mature crops before the heavy rain arrives. For rice, ensure excess water can drain.',
    });
  }

  // 4. Storm risk: wind > 50 km/h
  const windyDays = forecast.filter(f => f.windMaxKmh > 50);
  if (windyDays.length > 0) {
    const peakWind = Math.max(...windyDays.map(d => d.windMaxKmh));
    alerts.push({
      type: 'storm_risk',
      severity: peakWind > 70 ? 'critical' : 'warning',
      title: `💨 Storm / High Wind Alert (${peakWind.toFixed(0)} km/h)`,
      detail: `Wind gusts up to ${peakWind.toFixed(0)} km/h expected on ${windyDays.length} day(s). Lodging risk for tall crops (rice at heading, jute, maize).`,
      affectedDates: windyDays.map(d => d.date),
      farmingAdvice: 'Stake tall vegetable plants. For rice nearing harvest, drain field to firm the root zone. Postpone pesticide spraying (drift risk). Secure polytunnel and nursery structures.',
    });
  }

  // 5. Drought signal: 0mm rain for 5+ consecutive days AND ET0 > 5mm/day avg
  let maxDryStreak = 0, currentDryStreak = 0;
  const dryDates: string[] = [];
  for (const f of forecast) {
    if (f.precipitationMm < 1) {
      currentDryStreak++;
      dryDates.push(f.date);
      maxDryStreak = Math.max(maxDryStreak, currentDryStreak);
    } else {
      currentDryStreak = 0;
    }
  }
  const et0Days = forecast.filter(f => f.et0Mm !== null);
  const avgEt0 = et0Days.length > 0 ? et0Days.reduce((sum, f) => sum + (f.et0Mm || 0), 0) / et0Days.length : 0;
  if (maxDryStreak >= 5 && avgEt0 > 4) {
    alerts.push({
      type: 'drought_signal',
      severity: maxDryStreak >= 7 && avgEt0 > 6 ? 'critical' : 'warning',
      title: `🏜️ Drought Signal (${maxDryStreak} dry days, ET₀ ${avgEt0.toFixed(1)}mm/day)`,
      detail: `${maxDryStreak} consecutive days with <1mm rainfall and high evapotranspiration (${avgEt0.toFixed(1)}mm/day). Soil moisture depletion likely — irrigation urgency.`,
      affectedDates: dryDates,
      farmingAdvice: 'Prioritize irrigation for crops at critical stages (flowering, grain filling). Apply mulch to conserve soil moisture. For rice, maintain minimum 2-3cm standing water.',
    });
  }

  // 6. High humidity disease risk: humidity > 85% for 3+ days
  const humidDays = forecast.filter(f => f.humidityMeanPercent !== null && f.humidityMeanPercent > 85);
  if (humidDays.length >= 3) {
    const avgHumidity = humidDays.reduce((sum, f) => sum + (f.humidityMeanPercent || 0), 0) / humidDays.length;
    alerts.push({
      type: 'high_humidity',
      severity: humidDays.length >= 5 ? 'critical' : 'warning',
      title: `🦠 High Humidity Disease Risk (${humidDays.length} days > 85%)`,
      detail: `Average humidity ${avgHumidity.toFixed(0)}% over ${humidDays.length} days. Favorable conditions for blast (rice), late blight (potato/tomato), and fungal diseases.`,
      affectedDates: humidDays.map(d => d.date),
      farmingAdvice: 'Scout fields for early disease symptoms. Apply preventive fungicide (Mancozeb or Tricyclazole for rice blast) if symptoms appear. Improve field ventilation by removing excess weeds.',
    });
  }

  return alerts;
}

export async function getWeather(location: string): Promise<WeatherResult> {
  // Normalize Bangladesh district transliterations (e.g. "Bogura" → "Bogra")
  const normalized = normalizeLocation(location);

  // Step 1: geocode the location name → lat/long
  // Always filter to Bangladesh (country=BD) first — this avoids "Bogura" matching
  // a Russian town "Bogurayev" instead of Bogra district in Bangladesh.
  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(normalized)}&count=1&language=en&format=json&country=BD`;
  const geoRes = await fetch(geoUrl);
  if (!geoRes.ok) {
    throw new Error(`Geocoding failed: ${geoRes.status} ${geoRes.statusText}`);
  }
  const geoData = await geoRes.json();
  if (!geoData.results || geoData.results.length === 0) {
    // Fallback: try without country filter (for non-Bangladesh queries)
    const geoUrl2 = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(normalized + ' Bangladesh')}&count=1&language=en&format=json`;
    const geoRes2 = await fetch(geoUrl2);
    if (!geoRes2.ok) throw new Error(`Fallback geocoding failed: ${geoRes2.status} ${geoRes2.statusText}`);
    const geoData2 = await geoRes2.json();
    if (!geoData2.results || geoData2.results.length === 0) {
      throw new Error(`Could not geocode location: ${location} (no Bangladesh match found)`);
    }
    return fetchForecast(location, geoData2.results[0]);
  }
  return fetchForecast(location, geoData.results[0]);
}

async function fetchForecast(location: string, geoResult: any): Promise<WeatherResult> {
  const { latitude, longitude, name, admin1, country } = geoResult;
  const prettyLocation = [name, admin1, country].filter(Boolean).join(', ');

  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,et0_fao_evapotranspiration&hourly=relative_humidity_2m&timezone=Asia%2FDhaka&forecast_days=7`;
  const fcRes = await fetch(forecastUrl);
  if (!fcRes.ok) {
    throw new Error(`Forecast fetch failed: ${fcRes.status}`);
  }
  const fc = await fcRes.json();
  const d = fc.daily;

  if (!d?.time || !Array.isArray(d.time)) {
    throw new Error('Forecast response did not contain daily weather data');
  }

  // Open-Meteo exposes humidity hourly. Aggregate it by local calendar date so
  // pest/disease rules use real forecast humidity rather than a guessed value.
  const humidityByDate = new Map<string, number[]>();
  const hourlyTimes: string[] = fc.hourly?.time || [];
  const hourlyHumidity: Array<number | null> = fc.hourly?.relative_humidity_2m || [];
  hourlyTimes.forEach((time, i) => {
    const value = hourlyHumidity[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const date = time.slice(0, 10);
    const values = humidityByDate.get(date) || [];
    values.push(value);
    humidityByDate.set(date, values);
  });

  const forecast = d.time.map((date: string, i: number) => {
    const humidityValues = humidityByDate.get(date) || [];
    const humidityMeanPercent = humidityValues.length
      ? humidityValues.reduce((sum, value) => sum + value, 0) / humidityValues.length
      : null;
    const et0 = d.et0_fao_evapotranspiration?.[i];
    return {
      date,
      tempMaxC: Number(d.temperature_2m_max[i]),
      tempMinC: Number(d.temperature_2m_min[i]),
      precipitationMm: Number(d.precipitation_sum[i] || 0),
      precipitationProbability: Number(d.precipitation_probability_max[i] || 0),
      windMaxKmh: Number(d.wind_speed_10m_max[i] || 0),
      humidityMeanPercent: humidityMeanPercent === null ? null : Number(humidityMeanPercent.toFixed(1)),
      et0Mm: typeof et0 === 'number' ? et0 : null,
    };
  });
  if (forecast.length === 0) throw new Error('Forecast response contained no forecast days');

  const totalRain7dMm = forecast.reduce((s: number, f: any) => s + (f.precipitationMm || 0), 0);
  const avgTempC = forecast.reduce((s: number, f: any) => s + (f.tempMaxC + f.tempMinC) / 2, 0) / forecast.length;
  const humidityDays = forecast.filter(f => f.humidityMeanPercent !== null);
  const avgHumidityPercent = humidityDays.length
    ? humidityDays.reduce((sum, f) => sum + (f.humidityMeanPercent || 0), 0) / humidityDays.length
    : null;
  const et0DaysList = forecast.filter(f => f.et0Mm !== null);
  const totalEt0Mm = et0DaysList.length
    ? et0DaysList.reduce((sum, f) => sum + (f.et0Mm || 0), 0)
    : null;
  const rainyDays = forecast.filter((f: any) => f.precipitationMm >= 1).length;
  const firstRain = forecast.find((f: any) => f.precipitationMm >= 5);
  const nextRainEvent = firstRain ? { date: firstRain.date, mm: firstRain.precipitationMm } : null;

  // Generate rule-based agronomic alerts from the forecast
  const agronomicAlerts = generateAgronomicAlerts(forecast);

  return {
    location: prettyLocation,
    latitude,
    longitude,
    timezone: fc.timezone,
    forecast,
    summary: {
      totalRain7dMm: Number(totalRain7dMm.toFixed(1)),
      avgTempC: Number(avgTempC.toFixed(1)),
      avgHumidityPercent: avgHumidityPercent === null ? null : Number(avgHumidityPercent.toFixed(1)),
      totalEt0Mm: totalEt0Mm === null ? null : Number(totalEt0Mm.toFixed(1)),
      rainyDays,
      nextRainEvent,
    },
    agronomicAlerts,
  };
}
