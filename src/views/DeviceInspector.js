import m from "mithril";
import moment from "moment";
import sortBy from "lodash/sortBy";
import groupBy from "lodash/groupBy";
import countBy from "lodash/countBy";
import stream from "mithril/stream";
import { request } from "mithril";

import { conchApi } from "config";

import { RadialProgress, Spinner } from "./component/";

const Tabs = () => {
	const activeTab = stream();
	return {
		oninit: ({ attrs: { tabs } }) => {
			activeTab(tabs[0]);
		},
		view: ({ attrs: { tabs, activeDevice, deviceSettings } }) => {
			return [
				m(
					".tabs.is-centered.is-boxed.is-small",
					m(
						"ul",
						tabs.map(tab =>
							m(
								"li",
								{
									class:
										activeTab().title === tab.title &&
										"is-active",
									onclick() {
										activeTab(tab);
									}
								},
								m("a", tab.title)
							)
						)
					)
				),
				activeTab().component &&
					m(activeTab().component, { activeDevice, deviceSettings })
			];
		}
	};
};

const TimeToBurnin = {
	view: ({ attrs: { activeDevice, deviceSettings } }) => {
		if (deviceSettings() == null) return m(Spinner);

		const { uptime_since, last_seen } = activeDevice();

		if (last_seen == null)
			return m("p.is-size-4", "Device has not reported");

		if (deviceSettings().firmware !== "current")
			return m("p.is-size-4", "Burn-in not started");

		// 6 hours in seconds. Taken from the user settings used to store this value
		const maxBurnin = 21600;

		const numReboots = 3;
		const burninStageTime = maxBurnin / numReboots;
		const sinceLastReboot = uptime_since
			? moment().diff(moment(uptime_since), "seconds")
			: moment().diff(moment(last_seen), "seconds");

		const rebootCount = deviceSettings()["build.reboot_count"] || 0;

		const time =
			maxBurnin - (rebootCount * burninStageTime + sinceLastReboot);

		const percentage = (() => {
			if (rebootCount === numReboots) return 100;
			if (time < 0) return Math.trunc(rebootCount / numReboots * 100);
			return Math.trunc((maxBurnin - time) / time * 100);
		})();

		return [
			m(RadialProgress, {
				percentage,
				strokeWidth: "20px"
			}),
			percentage === 100
				? m("p.subtitle", "Burn-in Complete")
				: m(
						"p.subtitle",
						time < 0 && m("p", "Should have finished"),
						moment.duration(time, "seconds").humanize(true)
				  )
		];
	}
};

const OverviewTab = () => {
	let deviceTags;
	return {
		oninit: ({ attrs: { activeDevice } }) => {
			deviceTags = activeDevice.map(device => {
				let tags = [];
				if (device.health.toLowerCase() === "fail")
					tags.push(m(".tag.is-danger", "Failing Validaiton"));
				else if (device.health.toLowerCase() === "pass")
					tags.push(m(".tag.is-info", "Passing Validation"));
				else if (device.health.toLowerCase() === "unknown")
					tags.push(m(".tag.is-warning", "No report"));

				if (device.validated)
					tags.push(m(".tag.is-success", "Validated"));
				if (device.graduated)
					tags.push(m(".tag.is-success", "Graduated"));
				if (device.triton_setup)
					tags.push(m(".tag.is-success", "Triton Setup"));

				return tags;
			});
		},
		view: ({ attrs: { activeDevice, deviceSettings } }) => [
			m(".tags", deviceTags()),
			m(
				"section.info-tiles",
				m(
					".tile.is-ancestor.has-text-centered",
					m(
						".tile.is-parent.is-vertical",
						m(
							"article.tile.is-child.box",
							m("p.subtitle", "Last Reported"),
							m(
								"p.title",
								activeDevice().last_seen
									? moment(activeDevice().last_seen).fromNow()
									: "never"
							)
						),
						m(
							"article.tile.is-child.box",
							m("p.subtitle", "Uptime"),
							m(
								"p.title",
								activeDevice().uptime_since
									? moment(
											activeDevice().uptime_since
									  ).fromNow(true)
									: "Unknown"
							)
						),
						m(
							"article.tile.is-child.box",
							m("p.subtitle", "BIOS Version"),
							m(
								"p.title",
								activeDevice().latest_report
									? activeDevice().latest_report.bios_version
									: "unknown"
							)
						)
					),
					m(
						".tile.is-parent",
						m(
							"article.tile.is-child.box",
							m("p.subtitle", "Time for Burn-in"),
							m(TimeToBurnin, {
								activeDevice,
								deviceSettings
							})
						)
					)
				)
			)
		]
	};
};

const ValidationRows = () => {
	let revealDetails = false;
	const resultsToCountTags = results => {
		const counts = countBy(results, "status");
		const statusToColor = status => {
			switch (status) {
				case "fail":
					return "is-warning";
				case "error":
					return "is-danger";
				default:
					return "is-info";
			}
		};
		return Object.keys(counts).map(status =>
			m("span.tag", { class: statusToColor(status) }, counts[status])
		);
	};
	return {
		view: ({ attrs: { validation, results } }) => [
			m(
				"tr",
				{
					onclick() {
						revealDetails = !revealDetails;
					},
					class: revealDetails && "is-selected",
					style: "cursor: pointer"
				},
				m("td", resultsToCountTags(results)),
				m("td", validation.name),
				m(
					"td",
					validation.description ||
						m("span.has-text-grey", "No Description")
				)
			),
			revealDetails &&
				m(
					"tr",
					m(
						"td[colspan=3]",
						m(
							".content",
							m(
								"table.table.is-narrow.is-marginless.is-fullwidth",
								m(
									"thead",
									m(
										"tr",
										m("th"),
										m("th", "Status"),
										m("th", "Message"),
										m("th", "Hint")
									)
								),
								m(
									"tbody",
									sortBy(results, "order").map(result =>
										m(
											"tr",
											m("td", result.order + 1),
											m("td", result.status),
											m("td", result.message),
											m(
												"td",
												result.hint ||
													m(
														"span.has-text-grey",
														"No Hint"
													)
											)
										)
									)
								)
							)
						)
					)
				)
		]
	};
};

const ValidationTab = () => {
	const headers = [m("th", ""), m("th", "Name"), m("th", "Description")];
	const validationStates = stream();
	const validations = stream();

	// group results by validation
	const groupedValidationStateResults = validationStates.map(states =>
		states.map(state => groupBy(state.results, "validation_id"))
	);
	const idToValidation = validations.map(vs => {
		let map = vs.reduce((acc, v) => {
			acc[v.id] = v;
			return acc;
		}, {});
		return id => map[id];
	});

	const revealDetails = {};

	return {
		oninit: ({ attrs: { activeDevice } }) => {
			request({
				method: "GET",
				url: `${conchApi}/device/${activeDevice().id}/validation_state`,
				withCredentials: true
			}).then(validationStates);
			request({
				method: "GET",
				url: `${conchApi}/validation`,
				withCredentials: true
			}).then(validations);
		},
		view: ({ attrs: { activeDevice } }) => {
			return stream.merge([validationStates, validations])() == null
				? m(Spinner)
				: m(
						"table.table.is-narrow.is-marginless.is-fullwidth",
						m("thead", m("tr", headers)),
						m("tfoot", m("tr", headers)),
						groupedValidationStateResults().map(groupedResults => {
							return m(
								"tbody",
								sortBy(
									Object.keys(groupedResults),
									vid => idToValidation()(vid).name
								).map(vid =>
									m(ValidationRows, {
										results: groupedResults[vid],
										validation: idToValidation()(vid)
									})
								)
							);
						})
				  );
		}
	};
};

const SettingsTab = () => {
	const headers = [m("th", "Name"), m("th", "Value")];
	return {
		view: ({ attrs: { deviceSettings } }) => {
			return deviceSettings() == null
				? m(Spinner)
				: m(
						"table.table.is-narrow.is-fullwidth",
						m("thead", m("tr", headers)),
						m("tfoot", m("tr", headers)),
						Object.entries(deviceSettings())
							.sort()
							.map(([name, value]) =>
								m("tr", m("td", name), m("td", value))
							)
				  );
		}
	};
};

const StorageTab = () => {
	const headers = [
		m("th", "Serial Number"),
		m("th", "Enclosure"),
		m("th", "HBA"),
		m("th", "Slot Number"),
		m("th", "Vendor"),
		m("th", "Model"),
		m("th", "Size"),
		m("th", "Drive Type"),
		m("th", "Transport"),
		m("th", "Firmware"),
		m("th", "Health"),
		m("th", "Temperature")
	];
	let disks;

	return {
		oninit: ({ attrs: { activeDevice } }) => {
			disks = activeDevice.map(
				device =>
					(device.latest_report && device.latest_report.disks) || {}
			);
		},
		view: () => {
			return disks() == null
				? m(Spinner)
				: m(
						"table.table.is-narrow.is-fullwidth",
						m("thead", m("tr", headers)),
						m("tfoot", m("tr", headers)),

						Object.entries(disks())
							.map(([id, disk]) => {
								return {
									sortKey:
										100 * (parseInt(disk.hba) || 0) +
										(parseInt(disk.slot) || 0),
									value: [
										id,
										disk.enclosure,
										disk.hba,
										disk.slot,
										disk.vendor,
										disk.model,
										disk.size,
										disk.drive_type,
										disk.transport,
										disk.firmware,
										disk.health,
										disk.temp
									].map(d => m("td", d))
								};
							})
							.sort((a, b) => a.sortKey - b.sortKey)
							.map(a => m("tr", a.value))
				  );
		}
	};
};

const NetworkingTab = () => {
	const headers = [
		m("th", "Name"),
		m("th", "MAC"),
		m("th", "IP Address"),
		m("th", "State"),
		m("th", "Product"),
		m("th", "Peer Switch"),
		m("th", "Peer Port"),
		m("th", "Peer MAC")
	];
	let nics;

	return {
		oninit: ({ attrs: { activeDevice } }) => {
			nics = activeDevice.map(
				device =>
					(device.latest_report && device.latest_report.interfaces) ||
					{}
			);
		},
		view: () => {
			return nics() == null
				? m(Spinner)
				: m(
						"table.table.is-narrow.is-fullwidth",
						m("thead", m("tr", headers)),
						m("tfoot", m("tr", headers)),
						Object.entries(nics())
							.sort()
							.map(([id, iface]) =>
								m(
									"tr",
									[
										id,
										iface.mac,
										iface.ipaddr,
										iface.state,
										iface.product,
										iface.peer_switch,
										iface.peer_port,
										iface.peer_mac
									].map(a => m("td", a))
								)
							)
				  );
		}
	};
};

const ReportTab = () => {
	return {
		view: ({ attrs: { activeDevice } }) => {
			return activeDevice() == null
				? m(Spinner)
				: m(
						".content.has-text-left",
						m(
							"pre",
							JSON.stringify(
								activeDevice().latest_report || {},
								null,
								"  "
							)
						)
				  );
		}
	};
};

export default () => {
	const activeDevice = stream();
	const deviceSettings = stream();
	let deviceLoading = true;

	return {
		oninit: ({ attrs: { activeDeviceId } }) => {
			activeDeviceId.map(deviceId => {
				if (deviceId == null) return;
				deviceLoading = true;
				request({
					method: "GET",
					url: `${conchApi}/device/${deviceId}`,
					withCredentials: true
				}).then(res => {
					activeDevice(res);
					deviceLoading = false;
				});
				request({
					method: "GET",
					url: `${conchApi}/device/${deviceId}/settings`,
					withCredentials: true
				}).then(deviceSettings);
			});
		},
		view: ({ attrs: { activeDeviceId } }) => {
			return deviceLoading
				? m("section.section", m(Spinner))
				: [
						m(Tabs, {
							tabs: [
								{
									title: "Overview",
									component: OverviewTab
								},
								{
									title: "Validation",
									component: ValidationTab
								},
								{
									title: "Settings",
									component: SettingsTab
								},
								{
									title: "Storage",
									component: StorageTab
								},
								{
									title: "Networking",
									component: NetworkingTab
								},
								{
									title: "Latest Report",
									component: ReportTab
								}
							],
							activeDevice,
							deviceSettings
						})
				  ];
		}
	};
};
