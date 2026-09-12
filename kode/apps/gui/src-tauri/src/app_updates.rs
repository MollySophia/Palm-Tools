//! GitHub release channels. Only published releases participate; downloads still
//! go through Tauri's updater and the public key embedded in this application.
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Manager, Webview};
use tauri_plugin_updater::UpdaterExt;

const REPOSITORY: &str = "TencentYoutuResearch/Palm-Tools";

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    state: String,
    size: u64,
}

fn newest_release(releases: &[Release], beta: bool) -> Option<(&Release, Version)> {
    releases
        .iter()
        .filter(|release| !release.draft)
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.trim_start_matches('v')).ok()?;
            (beta || (!release.prerelease && version.pre.is_empty())).then_some((release, version))
        })
        .max_by(|(_, a), (_, b)| a.cmp_precedence(b))
}

fn newer_release<'a>(
    releases: &'a [Release],
    beta: bool,
    current: &Version,
) -> Option<(&'a Release, Version)> {
    newest_release(releases, beta).filter(|(_, version)| version.cmp_precedence(current).is_gt())
}

fn has_updater_assets(release: &Release, version: &Version) -> bool {
    let archive = format!("kode_{version}_{}.app.tar.gz", std::env::consts::ARCH);
    [
        "latest.json".to_owned(),
        archive.clone(),
        format!("{archive}.sig"),
    ]
    .iter()
    .all(|name| {
        release
            .assets
            .iter()
            .any(|asset| asset.name == *name && asset.state == "uploaded" && asset.size > 0)
    })
}

fn release_for_check<'a>(
    releases: &'a [Release],
    beta: bool,
    current: &Version,
    ignore_version: bool,
) -> Option<(&'a Release, Version)> {
    if ignore_version {
        newest_release(releases, beta)
    } else {
        newer_release(releases, beta, current)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    update: Option<UpdateMetadata>,
    // Distinguish an incomplete/legacy release from "already up to date".
    pending_version: Option<String>,
}

#[tauri::command]
pub async fn check_app_update(
    webview: Webview,
    beta: bool,
    ignore_version: Option<bool>,
) -> Result<CheckResult, String> {
    let ignore_version = ignore_version.unwrap_or(false);
    let client = reqwest::Client::builder()
        .user_agent("kode-updater")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    // Public API: never embed a GitHub token in the distributed application.
    let mut releases = Vec::new();
    for page in 1..=10 {
        let batch: Vec<Release> = client
            .get(format!(
                "https://api.github.com/repos/{REPOSITORY}/releases?per_page=100&page={page}"
            ))
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let complete = batch.len() < 100;
        releases.extend(batch);
        if complete {
            break;
        }
        if page == 10 {
            return Err("Too many releases to select an update safely".into());
        }
    }
    let empty = || CheckResult {
        update: None,
        pending_version: None,
    };
    let Some((release, version)) = release_for_check(
        &releases,
        beta,
        &webview.package_info().version,
        ignore_version,
    ) else {
        return Ok(empty());
    };
    if !has_updater_assets(release, &version) {
        return Ok(CheckResult {
            update: None,
            pending_version: Some(version.to_string()),
        });
    }
    let mut endpoint = url::Url::parse(&format!(
        "https://github.com/{REPOSITORY}/releases/download/"
    ))
    .map_err(|e| e.to_string())?;
    endpoint
        .path_segments_mut()
        .map_err(|_| "Invalid release URL")?
        .pop_if_empty()
        .push(&release.tag_name)
        .push("latest.json");
    let mut builder = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(15));
    if ignore_version {
        // Test reinstall as well as downgrade. This does not bypass signatures,
        // platform selection, or the manifest/tag consistency check below.
        builder = builder.version_comparator(|_, _| true);
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("Release manifest does not advertise the selected update".into());
    };
    if update.version != version.to_string() {
        return Err("Release tag and update manifest versions do not match".into());
    }
    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    };
    Ok(CheckResult {
        update: Some(metadata),
        pending_version: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, prerelease: bool, draft: bool) -> Release {
        Release {
            tag_name: tag.into(),
            prerelease,
            draft,
            assets: Vec::new(),
        }
    }

    #[test]
    fn channels_use_semver_and_exclude_drafts() {
        let releases = vec![
            release("v0.3.2", false, false),
            release("v0.3.10", false, false),
            release("v0.4.0-beta.2", true, false),
            release("v0.4.0-beta.10", true, false),
            release("v9.0.0", false, true),
            release("not-semver", false, false),
        ];
        assert_eq!(
            newest_release(&releases, false).unwrap().1.to_string(),
            "0.3.10"
        );
        assert_eq!(
            newest_release(&releases, true).unwrap().1.to_string(),
            "0.4.0-beta.10"
        );
    }

    #[test]
    fn stable_rejects_both_kinds_of_prerelease_marker() {
        let releases = vec![
            release("v0.3.0", true, false),
            release("v0.4.0-beta.1", false, false),
        ];
        assert!(newest_release(&releases, false).is_none());
    }

    #[test]
    fn beta_graduates_to_stable() {
        let releases = vec![
            release("v0.4.0-beta.10", true, false),
            release("v0.4.0", false, false),
        ];
        assert_eq!(
            newest_release(&releases, true).unwrap().1.to_string(),
            "0.4.0"
        );
    }

    #[test]
    fn switching_channels_never_downgrades_or_reinstalls() {
        let stable = vec![release("v0.3.0", false, false)];
        assert!(newer_release(&stable, false, &Version::parse("0.4.0-beta.1").unwrap()).is_none());
        assert!(newer_release(&stable, true, &Version::parse("0.3.0+local").unwrap()).is_none());
        let old_alpha = vec![release("v0.2.2-alpha.2", true, false)];
        assert!(newer_release(&old_alpha, true, &Version::parse("0.2.2-dev").unwrap()).is_none());
    }

    #[test]
    fn debug_allows_reinstall_and_downgrade_but_preserves_channel() {
        let releases = vec![
            release("v0.3.0", false, false),
            release("v0.4.0-beta.1", true, false),
            release("v9.0.0", false, true),
        ];
        for current in ["0.3.0", "0.5.0"] {
            let current = Version::parse(current).unwrap();
            assert!(release_for_check(&releases, false, &current, false).is_none());
            assert_eq!(
                release_for_check(&releases, false, &current, true)
                    .unwrap()
                    .1
                    .to_string(),
                "0.3.0"
            );
            assert_eq!(
                release_for_check(&releases, true, &current, true)
                    .unwrap()
                    .1
                    .to_string(),
                "0.4.0-beta.1"
            );
        }
    }

    #[test]
    fn updater_requires_manifest_archive_and_signature() {
        let mut r = release("v0.4.0-beta.1", true, false);
        let v = Version::parse("0.4.0-beta.1").unwrap();
        assert!(!has_updater_assets(&r, &v));
        let archive = format!("kode_{v}_{}.app.tar.gz", std::env::consts::ARCH);
        for name in [
            "latest.json".to_owned(),
            archive.clone(),
            format!("{archive}.sig"),
        ] {
            r.assets.push(Asset {
                name,
                state: "uploaded".into(),
                size: 1,
            });
        }
        assert!(has_updater_assets(&r, &v));
        r.assets[2].state = "starter".into();
        assert!(!has_updater_assets(&r, &v));
        r.assets[2].state = "uploaded".into();
        r.assets[2].size = 0;
        assert!(!has_updater_assets(&r, &v));
    }
}
