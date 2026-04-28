import { useEffect, useState } from "react";

type Config = {
  id?: string;
  name?: string;
  [key: string]: any;
};

export default function App() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfigs() {
      try {
        setLoading(true);

        const res = await fetch("/api/configs");

        if (!res.ok) {
          throw new Error(`Failed to fetch configs (${res.status})`);
        }

        const data = await res.json();

        setConfigs(data);
      } catch (err: any) {
        console.error("Config load failed:", err);
        setError(err.message || "Failed to load configs");
      } finally {
        setLoading(false);
      }
    }

    loadConfigs();
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const form = new FormData();
      form.append("glb", file);

      const res = await fetch("/api/upload/glb", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed (${res.status}): ${text}`);
      }

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Upload failed");
      }

      const configRes = await fetch("/api/configs");

      if (configRes.ok) {
        const newConfigs = await configRes.json();
        setConfigs(newConfigs);
      }
    } catch (err: any) {
      console.error("Upload error:", err);
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <h1>Warehouse NAV</h1>

      <div style={{ marginBottom: 20 }}>
        <input
          type="file"
          accept=".glb"
          onChange={handleUpload}
          disabled={uploading}
        />
        {uploading && <p>Uploading...</p>}
      </div>

      {error && (
        <div style={{ color: "red", marginBottom: 20 }}>
          Error: {error}
        </div>
      )}

      {loading ? (
        <p>Loading configs...</p>
      ) : (
        <div>
          <h2>Configs</h2>
          {configs.length === 0 ? (
            <p>No configs found</p>
          ) : (
            <ul>
              {configs.map((cfg, i) => (
                <li key={i}>
                  {cfg.name || cfg.id || JSON.stringify(cfg)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
