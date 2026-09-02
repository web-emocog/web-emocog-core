import os
import subprocess
from pathlib import Path
from pdf2image import convert_from_path

def convert_pptx_to_pdf(pptx_path: str, output_dir: str) -> str:
    """
    Конвертирует презентацию pptx в PDF.
    Возвращает путь к созданному pdf файлу.
    """
    try:
        # Вызов LibreOffice через командную строку
        subprocess.run([
            "libreoffice", "--headless", "--convert-to", "pdf",
            pptx_path, "--outdir", output_dir
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        # путь к новому PDF файлу
        base_name = Path(pptx_path).stem
        pdf_path = os.path.join(output_dir, f"{base_name}.pdf")
        
        if os.path.exists(pdf_path):
            return pdf_path
        else:
            raise FileNotFoundError("pdf файл не был создан")
            
    except Exception as e:
        raise Exception(f"Ошибка при конвертации pptx в pdf: {str(e)}")

def process_document_to_images(file_path: str, output_dir: str) -> list:
    """
    Принимает путь к pdf или pptx, 
    возвращает список путей к созданным изображениям
    """
    file_ext = Path(file_path).suffix.lower()
    working_pdf_path = file_path
    
    # Если это презентация, сначала делаем pdf
    if file_ext in ['.ppt', '.pptx']:
        working_pdf_path = convert_pptx_to_pdf(file_path, output_dir)
    elif file_ext != '.pdf':
        raise ValueError("Неподдерживаемый формат файла. Только pdf или pptx.")

    try:
        images = convert_from_path(working_pdf_path, dpi=200)
    except Exception as e:
        raise Exception(f"Ошибка при чтении pdf через poppler: {str(e)}")

    generated_images = []
    base_name = Path(file_path).stem

    for i, image in enumerate(images):
        image_name = f"{base_name}_slide_{i+1}.jpg"
        image_path = os.path.join(output_dir, image_name)
        
        image.save(image_path, 'JPEG', quality=85)
        generated_images.append(image_path)

    if working_pdf_path != file_path and os.path.exists(working_pdf_path):
        os.remove(working_pdf_path)

    return generated_images