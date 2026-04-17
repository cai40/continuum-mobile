import qrcode
import os

url = "exp://192.168.1.153:8081"
qr = qrcode.QRCode(
    version=1,
    error_correction=qrcode.constants.ERROR_CORRECT_L,
    box_size=10,
    border=4,
)
qr.add_data(url)
qr.make(fit=True)

img = qr.make_image(fill_color="black", back_color="white")
output_path = os.path.join(os.getcwd(), "expo_qr_sharp.png")
img.save(output_path)
print(f"QR code saved to {output_path}")
