//! Build-time synthetic snapshot, using Base's own execution test genesis and block driver.

use std::{path::PathBuf, sync::Arc, time::Duration};

use alloy_provider::RootProvider;
use alloy_rpc_types_engine::JwtSecret;
use base_builder_core::test_utils::{ChainDriver, EngineApi};
use base_common_chains::ChainConfig;
use base_common_genesis::{BaseUpgrade, RollupConfig};
use base_common_network::Base;
use base_execution_chainspec::BaseChainSpec;
use eyre::{Result, ensure};

use crate::{InProcessBuilder, InProcessBuilderConfig};

/// Whether this process uses Prool's synthetic fixture instead of mainnet state.
pub fn enabled() -> bool {
    std::env::var_os("PROOL_BASE_FIXTURE").is_some_and(|value| value == "1")
}

/// Fixed genesis shared by the build-time generator and runtime nodes.
pub fn chain_spec() -> BaseChainSpec {
    let mut genesis: serde_json::Value = serde_json::from_str(include_str!(
        "../../../crates/builder/core/src/test_utils/artifacts/genesis.json.tmpl"
    ))
    .expect("pinned Base test genesis");
    genesis["config"]["chainId"] = 8453.into();
    // The seed block uses the upstream driver's Jovian Engine API. Activate
    // Cobalt and its predecessors after that seed, before any local user blocks.
    genesis["config"]["osakaTime"] = 1_700_000_004u64.into();
    genesis["config"]["base"] = serde_json::json!({
        "azul": 1_700_000_004u64, "beryl": 1_700_000_004u64, "cobalt": 1_700_000_004u64,
    });
    genesis["config"]["activationAdminAddress"] =
        "0x000000000000000000000000000000000000dEaD".into();
    genesis["timestamp"] = "0x6553f100".into();
    // Keep only contracts. Consumers fund their own throwaway accounts with --prefund-address.
    genesis["alloc"]
        .as_object_mut()
        .unwrap()
        .retain(|_, account| account.get("code").is_some());
    let dev: serde_json::Value = serde_json::from_str(include_str!(
        "../../../crates/common/chains/res/genesis/dev.json"
    ))
    .expect("pinned BaseTime contracts");
    for address in [
        "0x4200000000000000000000000000000000000030",
        "0xc0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d30030",
    ] {
        genesis["alloc"][address] = dev["alloc"][address].clone();
    }
    BaseChainSpec::from_genesis(serde_json::from_value(genesis).expect("fixture genesis"))
}

/// Consensus configuration matching the selected execution genesis.
pub fn rollup_config() -> RollupConfig {
    let mut config = ChainConfig::mainnet().rollup_config();
    if !enabled() {
        return config;
    }
    config.clear_upgrade_activation_timestamps();
    for upgrade in [
        BaseUpgrade::Regolith,
        BaseUpgrade::Canyon,
        BaseUpgrade::Ecotone,
        BaseUpgrade::Fjord,
        BaseUpgrade::Granite,
        BaseUpgrade::Holocene,
        BaseUpgrade::Isthmus,
        BaseUpgrade::Jovian,
    ] {
        config.set_upgrade_activation_timestamp(upgrade, 0);
    }
    for upgrade in [BaseUpgrade::Azul, BaseUpgrade::Beryl, BaseUpgrade::Cobalt] {
        config.set_upgrade_activation_timestamp(upgrade, 1_700_000_004);
    }
    config.genesis.l2.number = 0;
    config.genesis.l2.hash = chain_spec().inner.genesis_header.hash();
    config.genesis.l2_time = 1_700_000_000;
    config
}

/// Executes and persists one L1-info block without an L1 node.
pub async fn prepare(datadir: PathBuf) -> Result<()> {
    ensure!(!datadir.exists(), "refusing to overwrite fixture datadir");
    std::fs::create_dir_all(&datadir)?;
    drop(reth_db::init_db(
        datadir.join("db"),
        reth_db::mdbx::DatabaseArguments::new(reth_db::ClientVersion::default()),
    )?);
    let jwt_secret = JwtSecret::random();
    let builder = InProcessBuilder::start(InProcessBuilderConfig {
        chain_spec: Arc::new(chain_spec()),
        datadir: Some(datadir),
        jwt_secret,
        http_port: None,
        ws_port: None,
        auth_port: None,
        p2p_port: None,
        flashblocks_port: None,
        metrics_port: None,
        enable_experimental_validity_transactions: false,
        payload_builder_cutover: false,
        extra_extensions: Vec::new(),
        block_time: Duration::from_secs(2),
        persistence_threshold: Some(0),
        txpool_max_transactions: None,
        txpool_max_size_mb: None,
        txpool_max_account_slots: None,
    })
    .await?;
    let driver = ChainDriver::remote(
        RootProvider::<Base>::new_http(builder.rpc_url()?),
        EngineApi::with_http(builder.engine_url()?.as_str())
            .with_jwt_secret(&hex::encode(jwt_secret.as_bytes())),
    );
    let block = driver
        .build_new_block_with_txs_timestamp(
            vec![],
            Some(true),
            Some(Duration::from_secs(1_700_000_002)),
            None,
            Some(0),
        )
        .await?;
    ensure!(
        block.header.number == 1,
        "fixture must contain exactly one post-genesis block"
    );
    crate::SnapshotBoundary::read(builder.rpc_url()?, Arc::new(rollup_config()), 8453, None)
        .await?;
    builder.shutdown().await?;
    Ok(())
}
