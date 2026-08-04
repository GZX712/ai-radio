/**
 * 天气服务 v2
 * 1. 优先用前端浏览器 GPS 坐标（手机 Geolocation，精确到基站/网络位置）
 * 2. 无坐标时用 ip-api.com IP 定位兜底
 * 3. 调 open-meteo.com 查当前天气
 */

export interface WeatherResult {
  city: string;
  temperature: number;
  description: string;
  windSpeed: number;
  weatherCode: number;
  summaryEn: string; // 英文简短（DJ 朗读）
  summaryZh: string; // 中文简短（字幕）
}

const FALLBACK_LOCATION = {
  city: "北京",
  country: "China",
  latitude: 39.9042,
  longitude: 116.4074,
};

// 前端 GPS 上报的坐标（优先，覆盖默认值）
// 默认南宁：辛老师实际位置（服务器重启/IP 兜底时不再跳回柳州/北京）
let userLocation: { latitude: number; longitude: number; city: string } = {
  latitude: 22.824,
  longitude: 108.320,
  city: "南宁",
};

async function fetchWeather(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = (await res.json()) as {
    current_weather?: { temperature: number; windspeed: number; weathercode: number };
  };
  if (!data.current_weather) throw new Error("No weather data");
  return data.current_weather;
}

/**
 * 用坐标反查城市名（open-meteo 不返回城市名，用离线简化：以坐标近似城市提示）
 * 实际上 open-meteo geocoding API 可以反查：
 */
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${lat},${lon}&count=1&language=zh&format=json`;
    // open-meteo geocoding 是按名称查，不支持坐标反查；改用大圆近似：直接返回"当前位置"
    void url;
  } catch { /* ignore */ }
  return "当前位置";
}

function weatherCodeToText(code: number): { en: string; zh: string } {
  if (code === 0) return { en: "clear sky", zh: "晴朗" };
  if (code <= 3) return { en: "partly cloudy", zh: "多云" };
  if (code <= 48) return { en: "foggy", zh: "有雾" };
  if (code <= 67) return { en: "rainy", zh: "下雨" };
  if (code <= 77) return { en: "snowy", zh: "下雪" };
  if (code <= 82) return { en: "showers", zh: "阵雨" };
  if (code <= 99) return { en: "thunderstorm", zh: "雷暴" };
  return { en: "unknown weather", zh: "未知" };
}

export const weatherService = {
  /** 前端 GPS 上报坐标（手机精确位置） */
  setUserLocation(lat: number, lon: number, city = "当前位置"): void {
    userLocation = { latitude: lat, longitude: lon, city };
    console.log(`[weather] 前端 GPS 定位：${city} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
  },

  async getCurrent(): Promise<WeatherResult | null> {
    let lat: number;
    let lon: number;
    let city = "当前位置";

    if (userLocation) {
      lat = userLocation.latitude;
      lon = userLocation.longitude;
      city = userLocation.city;
    } else {
      // IP 定位兜底
      try {
        const res = await fetch("http://ip-api.com/json/", { signal: AbortSignal.timeout(4000) });
        const j = (await res.json()) as { city?: string; lat?: number; lon?: number };
        if (j.lat && j.lon) {
          lat = j.lat;
          lon = j.lon;
          city = j.city ?? "当前位置";
        } else {
          lat = FALLBACK_LOCATION.latitude;
          lon = FALLBACK_LOCATION.longitude;
          city = FALLBACK_LOCATION.city;
        }
      } catch {
        lat = FALLBACK_LOCATION.latitude;
        lon = FALLBACK_LOCATION.longitude;
        city = FALLBACK_LOCATION.city;
      }
    }

    const w = await fetchWeather(lat, lon).catch(() => null);
    if (!w) return null;

    const text = weatherCodeToText(w.weathercode);
    return {
      city,
      temperature: w.temperature,
      description: text.en,
      windSpeed: w.windspeed,
      weatherCode: w.weathercode,
      summaryEn: `Weather in ${city}: ${text.en}, ${Math.round(w.temperature)}°C, wind ${Math.round(w.windspeed)} km/h.`,
      summaryZh: `${city}当前天气：${text.zh}，${Math.round(w.temperature)}°C，风速 ${Math.round(w.windspeed)} km/h。`,
    };
  },
};

// 保留导出（兼容 reverseGeocode 未用警告）
export { reverseGeocode };