// Tool 4: get_crop_calendar — dated schedule from land preparation to harvest
// Tier 0 #4. Produces a real dated calendar anchored on the farmer's sowing date.

import { CROPS } from '@/lib/kb/crops';

export interface CalendarEvent {
  day: number;          // relative day from sowing
  date: string;         // ISO date
  stage: string;
  action: string;
  advisory?: string;    // weather-aware advisory text
}

export interface CropCalendarResult {
  cropId: string;
  cropName: string;
  sowingDate: string;
  harvestDate: string;
  totalDays: number;
  events: CalendarEvent[];
  weatherAdvisories: string[];
}

function addDays(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error('sowingDate must use YYYY-MM-DD format');
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error('sowingDate must be a valid date');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getCropCalendar(cropId: string, sowingDate: string, weatherForecast?: { date: string; precipitationMm: number; tempMaxC?: number; tempMinC?: number; humidityMeanPercent?: number | null }[]): CropCalendarResult {
  const crop = CROPS.find(c => c.id === cropId);
  if (!crop) throw new Error(`Unknown crop id: ${cropId}`);

  const weatherAdvisories: string[] = [];
  const events: CalendarEvent[] = [];

  for (const stage of crop.growthStages) {
    for (const action of stage.keyActions) {
      const day = stage.dayRange[0];
      const date = addDays(sowingDate, day);

      // Weather-aware advisory: check if any forecast day overlaps this stage window
      let advisory: string | undefined;
      if (weatherForecast && weatherForecast.length > 0) {
        const stageStart = addDays(sowingDate, stage.dayRange[0]);
        const stageEnd = addDays(sowingDate, stage.dayRange[1]);
        const overlapping = weatherForecast.filter(f => f.date >= stageStart && f.date <= stageEnd);
        const overlappingRains = overlapping.filter(f => f.precipitationMm >= 5);

        // Rain advisory (existing)
        if (overlappingRains.length > 0) {
          const totalRain = overlappingRains.reduce((s, r) => s + r.precipitationMm, 0);
          if (action.toLowerCase().includes('urea') || action.toLowerCase().includes('top dress')) {
            advisory = `⚠ ${overlappingRains.length} rainy day(s) during this stage (total ${totalRain.toFixed(0)} mm). DELAY urea top dress by 2-3 days after rain to avoid runoff loss.`;
            weatherAdvisories.push(`${stage.name} (${date}): Heavy rain forecast during urea application window — delay by 2-3 days.`);
          } else if (crop.rainfallTolerance === 'low' && totalRain > 30) {
            advisory = `⚠ ${totalRain.toFixed(0)} mm rain during ${stage.name}. ${crop.name} has low rainfall tolerance — ensure drainage to avoid waterlogging/disease.`;
          } else if (action.toLowerCase().includes('irrigation')) {
            advisory = `Rain forecast in this window (${totalRain.toFixed(0)} mm) — skip or reduce irrigation.`;
          }
        }

        // NEW: Heat stress advisory (tempMax > 35°C during flowering/grain filling)
        const hotDays = overlapping.filter(f => typeof f.tempMaxC === 'number' && f.tempMaxC > 35);
        const isFloweringStage = /flower|heading|booting|grain|panicle|anthesis|pollination/i.test(stage.name);
        if (hotDays.length >= 2 && isFloweringStage) {
          const peakTemp = Math.max(...hotDays.map(f => f.tempMaxC!));
          const heatAdvisory = `🔥 Heat stress risk: ${hotDays.length} days > 35°C (peak ${peakTemp.toFixed(1)}°C) during ${stage.name}. Pollen sterility and grain yield loss likely. Ensure standing water 3-5cm in rice paddies; irrigate vegetables at dawn/dusk.`;
          advisory = advisory ? `${advisory}\n${heatAdvisory}` : heatAdvisory;
          weatherAdvisories.push(`${stage.name} (${date}): ${hotDays.length} hot days > 35°C — heat stress risk at reproductive stage.`);
        }

        // NEW: Cold snap / frost advisory (tempMin < 10°C during seedling/nursery)
        const coldDays = overlapping.filter(f => typeof f.tempMinC === 'number' && f.tempMinC < 10);
        const isSeedlingStage = /seedling|nursery|germination|emergence|transplant/i.test(stage.name);
        if (coldDays.length > 0 && isSeedlingStage) {
          const coldest = Math.min(...coldDays.map(f => f.tempMinC!));
          const coldAdvisory = `🥶 Cold snap: min ${coldest.toFixed(1)}°C on ${coldDays.length} day(s) during ${stage.name}. Cover seedbed with polythene/straw at night. Delay transplanting if <8°C. For Boro nursery, maintain 2-3cm water as thermal buffer.`;
          advisory = advisory ? `${advisory}\n${coldAdvisory}` : coldAdvisory;
          weatherAdvisories.push(`${stage.name} (${date}): Cold snap (${coldest.toFixed(1)}°C) — chilling injury risk for seedlings.`);
        }

        // NEW: High humidity disease advisory (>85% for 2+ days during vegetative/tillering)
        const humidDays = overlapping.filter(f => typeof f.humidityMeanPercent === 'number' && f.humidityMeanPercent !== null && f.humidityMeanPercent > 85);
        const isVegetativeStage = /vegetative|tillering|active growth|canopy|leaf/i.test(stage.name);
        if (humidDays.length >= 2 && (isVegetativeStage || isFloweringStage)) {
          const avgH = humidDays.reduce((s, f) => s + (f.humidityMeanPercent || 0), 0) / humidDays.length;
          const humidAdvisory = `🦠 High humidity (avg ${avgH.toFixed(0)}%) for ${humidDays.length} days during ${stage.name}. Scout for blast/blight symptoms. Preventive Mancozeb/Tricyclazole spray recommended. Ensure field ventilation — remove excess weeds.`;
          advisory = advisory ? `${advisory}\n${humidAdvisory}` : humidAdvisory;
          weatherAdvisories.push(`${stage.name} (${date}): High humidity ${avgH.toFixed(0)}% — disease-favorable conditions.`);
        }
      }

      events.push({ day, date, stage: stage.name, action, advisory });
    }
  }

  const harvestDate = addDays(sowingDate, crop.durationDays);

  return {
    cropId,
    cropName: crop.name,
    sowingDate,
    harvestDate,
    totalDays: crop.durationDays,
    events,
    weatherAdvisories,
  };
}
