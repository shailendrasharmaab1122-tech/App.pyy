export default async function handler(req, res) {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 2. Query Parameters (batchId aur lectureId jo aapne pehle maange the)
    const { batchId, lectureId } = req.query;

    // 3. Validation
    if (!batchId || !lectureId) {
        return res.status(400).json({ 
            error: "Missing required parameters: batchId and lectureId are required." 
        });
    }

    try {
        // 4. Target URL (Aapki pehli wali API)
        const targetUrl = `https://pw.modgalaxy.in/video-api?batchId=${encodeURIComponent(batchId)}&lectureId=${encodeURIComponent(lectureId)}`;

        // 5. Fetch Request
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Upstream API responded with status ${response.status}`);
        }

        const data = await response.json();
        
        return res.status(200).json(data);

    } catch (error) {
        console.error("Proxy Error:", error);
        return res.status(500).json({ 
            error: "Failed to fetch data.", 
            details: error.message 
        });
    }
}
