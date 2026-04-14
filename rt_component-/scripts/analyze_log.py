import argparse
from rt_mvp.analyzer import analyze_and_report

def main():
    # Создаём парсер аргументов командной строки
    p = argparse.ArgumentParser()
    
    # Обязательный аргумент: путь к файлу логов
    p.add_argument("log_path")
    
    # Обязательный аргумент: тип задачи (выбор из предложенных типов)
    p.add_argument("--task", required=True, choices=["simple", "choice", "go_nogo", "stroop", "pvt", "cpt"])
    
    # Опциональный аргумент: путь к файлу конфигурации
    p.add_argument("--config", type=str, default=None)
    
    # Парсим аргументы
    args = p.parse_args()
    
    # Анализируем логи и генерируем отчёт
    summary = analyze_and_report(args.log_path, args.task, config_path=args.config)
    
    # Выводим статус успешного завершения
    print("OK. reports written.")
    
    # Выводим ключевые флаги из результатов анализа
    for k, v in summary.get("flags", {}).items():
        print(f"{k}: {v.get('value')}")

if __name__ == "__main__":
    main()
