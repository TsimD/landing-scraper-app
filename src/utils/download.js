// utils/download.js

import axios from "axios";
import { createWriteStream, mkdirSync } from "fs";
import { dirname } from "path";

// Функция для скачивания файла по URL
export async function downloadFile(url, destinationPath) {
  try {
    mkdirSync(dirname(destinationPath), { recursive: true });
    const writer = createWriteStream(destinationPath);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (e) {
    // Мы ожидаем ошибки 404, таймауты и CORS. Просто логируем и идем дальше.
    throw new Error(`Download failed for ${url}: ${e.message}`);
  }
}
