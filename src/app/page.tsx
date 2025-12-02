// src/app/page.tsx 

"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase'; // ПРОВЕРЬТЕ ПУТЬ

// --- ИНТЕРФЕЙСЫ И ТИПЫ ДЛЯ TYPESCRIPT ---

// 1. Интерфейс для объекта задачи
interface Task {
  id: string;
  url: string;
  status: string;
  created_at: string;
  // Добавьте assets_count, так как вы его обновляете, хотя здесь он не отображается
  assets_count?: number; 
}

// 2. Явно объявляем типы для опций форматирования даты и CSS (для устранения ошибок сборки)
type DateTimeFormatOptions = Intl.DateTimeFormatOptions; 
type CSSProperties = React.CSSProperties;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

// Функция для форматирования даты
const formatTaskDate = (dateString: string) => {
  try {
    const options: DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    };
    
    // В зависимости от контекста, toLocaleDateString() может быть лучше для "Даты", но toLocaleTimeString тоже работает.
    return new Date(dateString).toLocaleTimeString('ru-RU', options);
  } catch {
    return dateString;
  }
};

// --- ГЛАВНЫЙ КОМПОНЕНТ ---
const HomePage = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  // ИСПРАВЛЕНО: Разрешаем строку ИЛИ null для состояния ошибки
  const [error, setError] = useState<string | null>(null); 
  // ИСПРАВЛЕНО: Явная типизация массива задач
  const [tasks, setTasks] = useState<Task[]>([]); 

  // --- ФУНКЦИЯ ЗАГРУЗКИ ИСТОРИИ ИЗ SUPABASE ---
  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching tasks:', error.message);
    } else {
      // Приведение типа, чтобы избежать ошибки TS
      setTasks(data as Task[] || []); 
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []); 

  // --- ОБРАБОТЧИК ОТПРАВКИ ФОРМЫ ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (response.ok) {
        // Логика скачивания файла (Blob)
        const contentDisposition = response.headers.get('Content-Disposition');
        const fileNameMatch = contentDisposition && contentDisposition.match(/filename="(.+)"/);
        const fileName = fileNameMatch ? fileNameMatch[1] : 'landing-page.zip';
        
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);

        await fetchTasks(); 
        setUrl('');
      } else {
        const errorData = await response.json();
        // ИСПРАВЛЕНО: Теперь строка может быть присвоена setError
        setError(`Ошибка: ${errorData.message || 'Не удалось скачать файл. Проверьте консоль.'}`);
      }
    } catch (e) {
      setError('Ошибка сети или сервера.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
  
  // --- КОМПОНЕНТ РЕНДЕРА ---
  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
      <h1>Landing Page Scraper (MVP)</h1>
      <p>Введите URL, чтобы скачать его локальную копию с очищенными путями.</p>

      {/* Форма */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px', marginBottom: '30px' }}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mysite.com"
          required
          disabled={loading}
          style={{ flexGrow: 1, padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }}
        />
        <button 
          type="submit" 
          disabled={loading} 
          style={{ 
            padding: '10px 20px', 
            cursor: loading ? 'not-allowed' : 'pointer', 
            backgroundColor: loading ? '#aaa' : '#007bff', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px' 
          }}
        >
          {loading ? 'Скачивание...' : 'Скачать ZIP'}
        </button>
      </form>
      {error && <p style={{ color: 'red', marginTop: '10px', padding: '10px', border: '1px solid red', backgroundColor: '#fee' }}>{error}</p>}
      
      <hr style={{ margin: '30px 0', borderColor: '#eee' }} />

      {/* Таблица истории задач */}
      <h2>История запросов ({tasks.length})</h2>
      
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '15px' }}>
        <thead>
          <tr style={{ backgroundColor: '#f4f4f4' }}>
            <th style={tableHeaderStyle}>URL</th>
            <th style={tableHeaderStyle}>Статус</th>
            <th style={tableHeaderStyle}>Дата</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td style={tableCellStyle} title={task.url}>{task.url.substring(0, 50)}...</td>
              <td style={{ 
                ...tableCellStyle, 
                color: task.status === 'DONE' ? 'green' : (task.status === 'ERROR' ? 'red' : 'orange'),
                fontWeight: 'bold'
              }}>
                {task.status}
              </td>
              <td style={tableCellStyle}>
                {formatTaskDate(task.created_at)}
              </td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr>
              <td colSpan="3" style={{ textAlign: 'center', padding: '15px', color: '#666' }}>
                История пока пуста. Запустите первый парсинг!
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

// --- СТИЛИ (Исправлено: Явная типизация React.CSSProperties) ---
const tableHeaderStyle: CSSProperties = { 
    padding: '12px', 
    border: '1px solid #ddd', 
    textAlign: 'left', 
    backgroundColor: '#e9e9e9' 
};
const tableCellStyle: CSSProperties = { 
    padding: '12px', 
    border: '1px solid #ddd', 
    wordBreak: 'break-word' 
};

export default HomePage;