import { useState } from "react";
import { Layout, theme, Typography, Empty, ConfigProvider } from "antd";
import { Sidebar } from "./components/Sidebar";
import { ObjectBrowser } from "./components/ObjectBrowser";
import type { SelectedBucket } from "./types";

const { Sider, Content } = Layout;
const { Text } = Typography;

interface AppContentProps {
  isDark: boolean;
  onThemeToggle: () => void;
}

function AppContent({ isDark, onThemeToggle }: AppContentProps) {
  const { token } = theme.useToken();
  const [selected, setSelected] = useState<SelectedBucket | null>(null);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        width={240}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          overflow: "hidden",
          height: "100vh",
          position: "fixed",
          left: 0,
          top: 0,
        }}
      >
        <Sidebar
          selected={selected}
          onSelect={setSelected}
          isDark={isDark}
          onThemeToggle={onThemeToggle}
        />
      </Sider>

      <Layout style={{ marginLeft: 240 }}>
        <Content style={{ background: token.colorBgLayout, minHeight: "100vh" }}>
          {selected ? (
            <ObjectBrowser key={`${selected.accountId}-${selected.bucket}`} target={selected} />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100vh",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Text type="secondary">
                    Select a bucket from the sidebar to start browsing
                  </Text>
                }
              />
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem("theme") === "dark"
  );

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <ConfigProvider
      theme={{ algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm }}
    >
      <AppContent isDark={isDark} onThemeToggle={toggleTheme} />
    </ConfigProvider>
  );
}
