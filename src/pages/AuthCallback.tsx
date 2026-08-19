import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function AuthCallback() {
  const { setSessionToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/session_id=([^&]+)/);
    if (match && match[1]) {
      setSessionToken(match[1]);
      navigate("/", { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [navigate, setSessionToken]);

  return (
    <div className="min-h-screen flex items-center justify-center paper text-muted-foreground">
      <div className="text-sm font-mono animate-pulse">Giriş yapılıyor...</div>
    </div>
  );
}
