using System;
using System.Drawing;
using System.IO;

class Program {
    static void Main() {
        string pngPath = @"f:\Projects\ai-novel-writer\src-tauri\icons\icon.png";
        string icoPath = @"f:\Projects\ai-novel-writer\src-tauri\icons\icon.ico";
        
        using (var png = Image.FromFile(pngPath))
        using (var bmp = new Bitmap(png, 32, 32))
        using (var fs = new FileStream(icoPath, FileMode.Create)) {
            // Write ICO header
            fs.WriteByte(0); fs.WriteByte(0); // reserved
            fs.WriteByte(1); fs.WriteByte(0); // type = ICO
            fs.WriteByte(1); fs.WriteByte(0); // 1 image
            
            // Write directory entry
            fs.WriteByte(32); // width
            fs.WriteByte(32); // height
            fs.WriteByte(0);  // colors
            fs.WriteByte(0);  // reserved
            fs.WriteByte(1); fs.WriteByte(0); // planes
            fs.WriteByte(32); fs.WriteByte(0); // bpp
            
            using (var ms = new MemoryStream()) {
                bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Bmp);
                byte[] bmpData = ms.ToArray();
                int size = bmpData.Length;
                // Size + DIB header size
                byte[] sizeBytes = BitConverter.GetBytes(size);
                fs.Write(sizeBytes, 0, 4);
                // Offset
                byte[] offsetBytes = BitConverter.GetBytes(22); // 6 header + 16 entry
                fs.Write(offsetBytes, 0, 4);
                // Write BMP data
                fs.Write(bmpData, 0, bmpData.Length);
            }
        }
        Console.WriteLine("ICO created: " + new FileInfo(icoPath).Length + " bytes");
    }
}
