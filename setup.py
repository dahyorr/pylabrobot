from setuptools import setup, find_packages

from pylabrobot.__version__ import __version__

with open("README.md", "r", encoding="utf-8") as f:
  long_description = f.read()


extras_fw = [
  "pyusb"
]

extras_http = [
  "requests",
  "types-requests"
]

extras_plate_reading = [
  "pylibftdi",
]

extras_websockets = [
  "websockets"
]

extras_simulation = extras_websockets

extras_venus = [
  "pyhamilton"
]

extras_opentrons = [
  "opentrons-http-api-client",
  "opentrons-shared-data"
]

extras_server = [
  "flask[async]",
]

extras_dev = extras_fw + extras_http + extras_plate_reading + extras_websockets + \
    extras_simulation + extras_opentrons + extras_server + [
    "sphinx_book_theme",
    "myst_nb",
    "sphinx_copybutton",
    "pytest",
    "pytest-timeout",
    "pylint",
    "mypy",
    "responses"
  ]

# Some extras are not available on all platforms. `dev` should be available everywhere
extras_all = extras_dev + extras_venus

setup(
  name="PyLabRobot",
  version=__version__,
  packages=find_packages(exclude="tools"),
  description="A hardware agnostic platform for liquid handling",
  long_description=long_description,
  long_description_content_type="text/markdown",
  install_requires=["typing_extensions"],
  url="https://github.com/pylabrobot/pylabrobot.git",
  package_data={"pylabrobot": ["liquid_handling/backends/simulation/simulator/*"]},
  extras_require={
    "fw": extras_fw,
    "http": extras_http,
    "plate_reading": extras_plate_reading,
    "websockets": extras_websockets,
    "simulation": extras_simulation,
    "venus": extras_venus,
    "opentrons": extras_opentrons,
    "server": extras_server,
    "dev": extras_dev,
    "all": extras_all,
  },
  entry_points={
    "console_scripts": [
      "lh-server=pylabrobot.server.liquid_handling_server:main",
      "plr-gui=pylabrobot.liquid_handling.backends.simulation.simulator.gui:main",
    ],
  }
)
