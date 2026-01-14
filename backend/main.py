import cv2
import numpy as np
import base64
import time
import mysql.connector
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from ultralytics import YOLO
from datetime import datetime
import os

app = FastAPI()

# YOLOモデル
model = YOLO("yolov8n.pt")
db_host = os.getenv("DB_HOST", "localhost")
# MySQL接続設定
db_config = {
    "host": "db_host",
    "user": "root",
    "password": "password",  # ここはご自身のパスワードに
    "database": "monitoring_db"
}

# 保存間隔の管理用辞書 { track_id: last_saved_time(float) }
last_saved = {}
SAVE_INTERVAL = 1.0  # 保存間隔（秒）

def save_to_db(track_id, x, y):
    """
    DBへの保存を実行する関数
    """
    try:
        # 都度接続（コネクションプーリングを使うのがベストですが，簡易実装として）
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()
        
        query = """
            INSERT INTO human_logs (track_id, center_x, center_y, timestamp) 
            VALUES (%s, %s, %s, %s)
        """
        now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        cursor.execute(query, (track_id, x, y, now_str))
        conn.commit()
        
        cursor.close()
        conn.close()
        # print(f"Saved: ID={track_id}, Time={now_str}") # デバッグ用ログ
    except mysql.connector.Error as err:
        print(f"MySQL Error: {err}")
    except Exception as e:
        print(f"General Error: {e}")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Client Connected")
    
    try:
        while True:
            # 1. 画像受信
            data = await websocket.receive_text()
            
            # 画像変換処理
            try:
                img_data = base64.b64decode(data.split(',')[1])
                np_arr = np.frombuffer(img_data, np.uint8)
                frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            except:
                continue # 画像が壊れていたらスキップ

            # 2. YOLO推論 (トラッキング)
            results = model.track(frame, persist=True, classes=0, verbose=False)
            
            detected_objects = []
            current_time = time.time()

            for r in results:
                if r.boxes.id is not None:
                    boxes = r.boxes.xyxy.cpu().numpy()
                    track_ids = r.boxes.id.int().cpu().tolist()

                    for box, track_id in zip(boxes, track_ids):
                        x1, y1, x2, y2 = map(int, box)
                        cx, cy = (x1 + x2) // 2, y2

                        # --- 保存ロジック (ここが重要) ---
                        # まだ保存したことがないID，または前回から1秒以上経過している場合
                        if track_id not in last_saved or (current_time - last_saved[track_id] > SAVE_INTERVAL):
                            save_to_db(track_id, cx, cy)
                            last_saved[track_id] = current_time
                        
                        # フロントエンドへの返却用データ
                        detected_objects.append({
                            "id": track_id,
                            "box": [x1, y1, x2, y2],
                            "center": [cx, cy]
                        })

            # 3. 結果返却
            await websocket.send_json(detected_objects)

    except WebSocketDisconnect:
        print("Client disconnected")
        # 接続が切れたらメモリキャッシュをクリアするか検討（今回はそのままでOK）