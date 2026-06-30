export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'application/json');

    try {
        const response = await fetch("https://eduvibe-mj.pages.dev/allbatches.json");
        if (!response.ok) throw new Error("Core database array unreachable.");
        const data = await response.json();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: "Failed to load proxy stream engine data." });
    }
}