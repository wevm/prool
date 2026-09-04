//! Build-time entrypoint for the bundled synthetic snapshot.

#[tokio::main]
async fn main() -> eyre::Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let path = std::env::args_os()
        .nth(1)
        .ok_or_else(|| eyre::eyre!("datadir required"))?;
    base_system_tests::prool_fixture::prepare(path.into()).await
}
